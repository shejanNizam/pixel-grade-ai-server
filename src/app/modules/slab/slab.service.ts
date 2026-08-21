import httpStatus from "http-status";
import { Types } from "mongoose";
import QRCode from "qrcode";
import sharp from "sharp";
import { uploadBufferToCloudinary } from "../../config/cloudinary.config";
import { configs } from "../../config/index";
import {
  SLAB_DEFAULTS,
  SLAB_STYLES,
  SlabCardRenderMode,
  SlabStyle,
} from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { ImageGenProvider } from "../../services/imagegen.provider";
import { logger } from "../../utils/logger";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { ImageSide } from "../analysis/analysis.interface";
import { AnalysisImage } from "../analysis/analysis.model";
import { Card } from "../card/card.model";
import { GradingReport } from "../grading/grading.model";
import { User } from "../user/user.model";
import {
  buildLabelOnlyPng,
  buildPdf,
  compositePng,
  LabelText,
} from "./slab.composite";
import { computeLayout } from "./slab.geometry";
import { ISlabLabel } from "./slab.interface";
import { SlabLabel } from "./slab.model";

/**
 * Pixel ID, derived from the report id.
 *
 * Deterministic on purpose — the same report always prints the same id, so a
 * regenerated or re-exported label stays verifiable against the original.
 *
 * Named "cert number" through prototype V1 and renamed on the printed band to
 * "PIXEL ID" (client, 2026-07-29). The VALUE FORMAT IS UNCHANGED so ids already
 * issued keep resolving; only the caption above it moved.
 */
const pixelIdFor = (reportId: string): string =>
  `PG-${reportId.slice(-10).toUpperCase()}`;

/**
 * QR payload — the public verification page for this report.
 *
 * Points at the frontend rather than the API: a collector scanning a slab
 * should land on a readable page, not a JSON document.
 */
const verifyUrlFor = (reportId: string): string =>
  `${configs.frontend_url}/verify/${pixelIdFor(reportId)}`;

/**
 * Renders the QR as a data URI for the SVG label band.
 *
 * Never fatal: a missing QR costs a convenience feature, whereas throwing here
 * would fail the whole export and lose the grade the user paid for. The band
 * lays out correctly with the slot empty.
 */
const buildQrDataUri = async (reportId: string): Promise<string | undefined> => {
  try {
    return await QRCode.toDataURL(verifyUrlFor(reportId), {
      errorCorrectionLevel: "M",
      margin: 1,
      // Generated at print resolution — the band scales it down, and a QR
      // upscaled from a small raster will not scan off a printed slab.
      width: 512,
      color: { dark: "#000000ff", light: "#ffffffff" },
    });
  } catch (error) {
    logger.error("Slab QR generation failed", { reportId, error });
    return undefined;
  }
};

/** How long a single asset download may take before it is abandoned. */
const ASSET_FETCH_TIMEOUT_MS = 60_000;
const ASSET_FETCH_ATTEMPTS = 3;

/**
 * Downloads a slab asset (generated artwork, card image) into memory.
 *
 * Retried and time-boxed, which it was not originally — and that omission is
 * what surfaced as a bare `TypeError: terminated` from undici. Node's fetch
 * throws that when the connection drops mid-body, with no status and no URL,
 * so it propagated to the client as the single word "terminated" with nothing
 * to debug from.
 *
 * A `generated`-mode render pulls five freshly-uploaded multi-megabyte images
 * from Cloudinary back-to-back, which is exactly the shape of traffic that
 * hits a transient reset. One dropped connection should cost a retry, not the
 * whole slab.
 */
const fetchBuffer = async (url: string, label = "asset"): Promise<Buffer> => {
  let lastError: unknown;

  for (let attempt = 1; attempt <= ASSET_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(ASSET_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        // A 4xx will never succeed on retry; only 5xx and 429 are worth another go.
        if (response.status < 500 && response.status !== 429) {
          throw new AppError(
            httpStatus.BAD_GATEWAY,
            `Could not fetch ${label} (${response.status}).`,
          );
        }
        throw new Error(`HTTP ${response.status}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof AppError) throw error;

      lastError = error;
      logger.warn("Slab asset fetch failed — retrying", {
        label,
        url,
        attempt,
        error: (error as Error)?.message,
      });

      if (attempt < ASSET_FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }

  throw new AppError(
    httpStatus.BAD_GATEWAY,
    `Could not download the ${label} after ${ASSET_FETCH_ATTEMPTS} attempts: ${
      (lastError as Error)?.message ?? "unknown error"
    }`,
  );
};

/** The user's own front photograph — the card that was actually graded. */
const scannedFrontUrl = async (
  analysisId: Types.ObjectId,
): Promise<string | undefined> => {
  const front = await AnalysisImage.findOne({
    analysis: analysisId,
    side: ImageSide.front,
  }).sort({ slotIndex: 1 });

  return front?.imageUrl;
};

/**
 * Decides what goes in the slab's card window.
 *
 * Driven by SLAB_CARD_RENDER_MODE. Each mode degrades into the next rather
 * than failing, so a slab always renders something: `generated` falls back to
 * the catalogue image, which falls back to the user's scan.
 *
 * ⚠️ `generated` is a client directive (2026-07-30) taken over a written
 * objection — see docs/OPEN-QUESTIONS.md. Under it the window holds an AI
 * imitation of the card rather than the card, while the label beside it still
 * carries a real grade and a scannable Pixel ID. The mode and the resulting
 * URL are both recorded on the label so any slab can be audited for which it
 * was. Default is `scan`.
 */
const resolveCardImage = async (
  mode: SlabCardRenderMode,
  analysisId: Types.ObjectId,
  card: { name: string; setExpansion?: string; cardNumber?: string; rarity?: string; releaseYear?: number; officialImageUrl?: string },
): Promise<{ url: string; source: SlabCardRenderMode }> => {
  // Client directive: slab preview must display the exact card image selected/identified by Scrydex
  if (card.officialImageUrl) {
    return { url: card.officialImageUrl, source: "catalogue" };
  }

  const scan = await scannedFrontUrl(analysisId);
  if (scan) return { url: scan, source: "scan" };

  throw new AppError(
    httpStatus.BAD_REQUEST,
    "No card image is available for this report.",
  );
};

/** Loads the report plus the joined data the label needs. */
const loadContext = async (userId: string, reportId: string) => {
  const report = await GradingReport.findById(reportId);
  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Grading report not found");
  }

  const card = await Card.findById(report.card);
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");

  const owner = await User.findById(report.user || userId).select("name username avatar");

  return { report, card, owner };
};

/** "Alex Alfred" -> "AA"; used when the owner has no avatar image. */
const initialsOf = (name: string): string =>
  name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

/** Cap on an avatar download. Small on purpose — it is drawn at ~9 mm. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Fetches the owner's avatar and inlines it as a data URI.
 *
 * librsvg will not fetch a remote `href` out of an SVG, so the bytes have to be
 * embedded. Never fatal: a failed avatar costs the disc image, not the slab.
 */
const buildAvatarDataUri = async (
  url?: string,
): Promise<string | undefined> => {
  if (!url) return undefined;

  try {
    const buffer = await fetchBuffer(url, "owner avatar");
    if (buffer.byteLength > MAX_AVATAR_BYTES) return undefined;

    // Normalised through sharp rather than trusted: it fixes the MIME type,
    // strips anything exotic, and caps the embedded size so a 4K profile photo
    // does not get base64'd into every slab SVG.
    const png = await sharp(buffer)
      .resize(256, 256, { fit: "cover" })
      .png()
      .toBuffer();

    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    logger.warn("Slab owner avatar could not be embedded", { url, error });
    return undefined;
  }
};

const buildLabelText = (
  report: Awaited<ReturnType<typeof loadContext>>["report"],
  card: Awaited<ReturnType<typeof loadContext>>["card"],
  qrDataUri?: string,
  owner?: Awaited<ReturnType<typeof loadContext>>["owner"],
  ownerAvatarDataUri?: string,
): LabelText => ({
  cardName: card.name,
  setExpansion: card.setExpansion,
  cardNumber: card.cardNumber,
  language: card.language,
  year: card.releaseYear ? String(card.releaseYear) : undefined,
  grade: report.grade,
  gradeLabel: report.gradeLabel,
  // Read from the stored report, which the grading service set server-side.
  pixelVerified: report.pixelVerified,
  pixelId: pixelIdFor(String(report._id)),
  qrDataUri,
  ownerUsername: owner?.username,
  ownerAvatarDataUri,
  ownerInitials: owner?.name ? initialsOf(owner.name) : undefined,
});

/**
 * Creates a label for a report: generates the background, composites, exports.
 *
 * Geometry defaults come from the schema, so a label created today keeps its
 * dimensions even if the printer's spec sheet changes tomorrow.
 */
const createLabel = async (
  userId: string,
  reportId: string,
  styleId: SlabStyle,
) => {
  const { report, card } = await loadContext(userId, reportId);

  // `report` and `card` are re-read inside renderLabel rather than threaded
  // through — one load path is easier to keep correct than two.
  void card;

  const label = await SlabLabel.create({
    report: report._id,
    user: userId,
    styleId,
  });

  return renderLabel(userId, String(label._id));
};

/**
 * Renders (or re-renders) a label's artwork and exports.
 *
 * Generates the four EXT. ART options when the label has none, composites
 * EVERY option, and selects one. Compositing all four up front is what makes
 * switching between them instant: the client requires the preview to be the
 * real export ("the preview should always match the final exported design"),
 * and re-compositing on each click would put a two-second wait behind a
 * control the user is meant to flick through.
 *
 * Only the ARTWORK is generated. The card and the label are drawn by us, at
 * fixed coordinates, so a bad generation can never shift the card window or
 * corrupt the label.
 */
const renderLabel = async (userId: string, labelId: string) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  const { report, card, owner } = await loadContext(
    userId,
    String(label.report),
  );
  const layout = computeLayout(label as ISlabLabel);

  // Artwork and card image are independent, so they run TOGETHER. Under
  // `generated` mode this is the difference between five image generations in
  // series and two waves — roughly a minute of wall time on a request that is
  // already uncomfortably long.
  //
  // The confirmed card drives the art direction: the provider renders the
  // ENVIRONMENT that card evokes, never the creature or the card art itself,
  // which is the publisher's copyrighted work (see imagegen.provider.ts).
  const needsArtwork = label.variants.length === 0;

  const [artworkUrls, resolvedCard] = await Promise.all([
    needsArtwork
      ? ImageGenProvider.generateExtArtSet({
          cardName: card.name,
          setExpansion: card.setExpansion,
          types: card.types,
        })
      : Promise.resolve(null),
    // Resolved once and frozen on the label. Under `generated` mode this is a
    // billed image, so re-deriving it on every background regeneration would
    // both cost money and quietly change the card the slab depicts.
    label.cardImageUrl
      ? Promise.resolve(null)
      : resolveCardImage(configs.SLAB.card_render_mode, report.analysis, card),
  ]);

  if (artworkUrls) {
    label.variants = artworkUrls.map((artworkUrl, i) => ({
      index: i + 1,
      artworkUrl,
    }));
    label.selectedVariant = 1;
  }

  if (resolvedCard) {
    label.cardImageUrl = resolvedCard.url;
    label.cardImageSource = resolvedCard.source;
  }

  // resolveCardImage either returns a URL or throws, so by here this is set —
  // the guard is for the type checker and for anyone who reorders the above.
  if (!label.cardImageUrl) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No card image is available for this report.",
    );
  }

  const [cardBuffer, qrDataUri, ownerAvatarDataUri] = await Promise.all([
    fetchBuffer(label.cardImageUrl, "card image"),
    buildQrDataUri(String(report._id)),
    buildAvatarDataUri(owner?.avatar?.url),
  ]);

  const text = buildLabelText(
    report,
    card,
    qrDataUri,
    owner,
    ownerAvatarDataUri,
  );

  // Sequential on purpose. Each composite is a full-canvas sharp pipeline plus
  // a Cloudinary upload; running four at once on a shared box spikes memory
  // hard enough to matter, and the user is already waiting on generation.
  for (const variant of label.variants) {
    if (variant.compositeUrl) continue;

    const backgroundBuffer = await fetchBuffer(
      variant.artworkUrl,
      `EXT. ART ${variant.index} artwork`,
    );
    const png = await compositePng(layout, backgroundBuffer, cardBuffer, text);
    const upload = await uploadBufferToCloudinary(
      png,
      `slab-${labelId}-v${label.version}-ext${variant.index}`,
    );
    variant.compositeUrl = upload?.secure_url;
  }

  label.markModified("variants");

  return applySelection(label, label.selectedVariant ?? 1);
};

/**
 * Points the label's exported assets at one variant.
 *
 * The PNG is already rendered for every variant, so this only has to build the
 * PDF — which is why selection is fast enough to sit behind a click. Splitting
 * it out also means selection and generation cannot drift: there is exactly one
 * place that decides what "the export" is.
 */
const applySelection = async (
  label: ISlabLabel,
  variantIndex: number,
) => {
  // Legacy labels (pre-2026-07-30) carry no variants and keep the single
  // background they were sold with.
  if (label.variants.length === 0) {
    await label.save();
    return label;
  }

  const variant =
    label.variants.find((v) => v.index === variantIndex) ?? label.variants[0];

  label.selectedVariant = variant.index;
  label.backgroundUrl = variant.artworkUrl;
  label.compositeUrl = variant.compositeUrl;
  label.exportPngUrl = variant.compositeUrl;

  if (variant.compositeUrl) {
    const png = await fetchBuffer(
      variant.compositeUrl,
      `EXT. ART ${variant.index} composite`,
    );
    const pdf = await buildPdf(
      png,
      label.widthMm + label.bleedMm * 2,
      label.heightMm + label.bleedMm * 2,
    );
    const pdfUpload = await uploadBufferToCloudinary(
      pdf,
      `slab-${String(label._id)}-v${label.version}-ext${variant.index}-pdf`,
    );
    label.exportPdfUrl = pdfUpload?.secure_url;
  }

  await label.save();
  return label;
};

/**
 * Switches the label to a different EXT. ART option.
 *
 * Costs nothing at the image provider — the artwork already exists. This is
 * the path the UI's thumbnail grid uses.
 */
const selectVariant = async (
  userId: string,
  labelId: string,
  variantIndex: number,
) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  const exists = label.variants.some((v) => v.index === variantIndex);
  if (!exists) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `This label has no EXT. ART ${variantIndex}.`,
    );
  }

  return applySelection(label, variantIndex);
};

/**
 * Throws away the current options and generates four completely new ones.
 *
 * ⚠️ Four billed images every time it is called, and nothing rate-limits it —
 * see docs/OPEN-QUESTIONS.md, the client has not set a cap.
 *
 * `version` increments so the new composites upload under fresh public ids
 * rather than overwriting the previous batch: labels are retained permanently
 * and a label already ordered must keep resolving to the art it was sold with.
 */
const regenerateBackground = async (userId: string, labelId: string) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  label.variants = [];
  label.selectedVariant = undefined;
  label.backgroundUrl = undefined;
  label.compositeUrl = undefined;
  label.version += 1;
  await label.save();

  return renderLabel(userId, labelId);
};

/** Preview PNG with the bleed/trim/safe guides drawn on. Never exported. */
const previewWithGuides = async (userId: string, labelId: string) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");
  if (!label.backgroundUrl) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This label has no background yet — generate it first.",
    );
  }

  const { report, card, owner } = await loadContext(
    userId,
    String(label.report),
  );
  const layout = computeLayout(label as ISlabLabel);

  // Reuses whatever the label already froze. The guide overlay is a checking
  // tool, so it must show the same card image the export does — and under
  // `generated` mode re-resolving here would buy a second billed image that
  // then differs from the one on the actual slab.
  const cardImageUrl =
    label.cardImageUrl ??
    (await resolveCardImage(configs.SLAB.card_render_mode, report.analysis, card))
      .url;

  const [backgroundBuffer, cardBuffer, ownerAvatarDataUri] = await Promise.all([
    fetchBuffer(label.backgroundUrl, "background artwork"),
    fetchBuffer(cardImageUrl, "card image"),
    buildAvatarDataUri(owner?.avatar?.url),
  ]);

  return compositePng(
    layout,
    backgroundBuffer,
    cardBuffer,
    // The guide overlay measures the real band, so it needs the real identity
    // column — a placeholder here would check a layout nobody prints.
    buildLabelText(report, card, undefined, owner, ownerAvatarDataUri),
    { showGuides: true },
  );
};

/** Export full slab print file with transparent/blank card window for physical slab printing */
const exportPrintSlab = async (userId: string, labelId: string, format: "png" | "pdf" = "pdf") => {
  const label = await SlabLabel.findById(labelId);
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  const requestingUser = await User.findById(userId);
  const isStaff = requestingUser?.role === "admin" || requestingUser?.role === "super_admin";
  if (!isStaff && String(label.user) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied to this slab label");
  }

  if (!label.backgroundUrl) {
    throw new AppError(httpStatus.BAD_REQUEST, "Label has no background generated yet");
  }

  const { report, card, owner } = await loadContext(String(label.user), String(label.report));
  const layout = computeLayout(label as ISlabLabel);
  const [backgroundBuffer, qrDataUri, ownerAvatarDataUri] = await Promise.all([
    fetchBuffer(label.backgroundUrl, "background artwork"),
    buildQrDataUri(String(report._id)),
    buildAvatarDataUri(owner?.avatar?.url),
  ]);

  const png = await compositePng(
    layout,
    backgroundBuffer,
    Buffer.alloc(0),
    buildLabelText(report, card, qrDataUri, owner, ownerAvatarDataUri),
    { showCase: false, excludeCardImage: true },
  );

  if (format === "png") return { buffer: png, mimeType: "image/png", extension: "png" };

  const pdf = await buildPdf(
    png,
    SLAB_DEFAULTS.widthMm + 2 * SLAB_DEFAULTS.bleedMm,
    SLAB_DEFAULTS.heightMm + 2 * SLAB_DEFAULTS.bleedMm,
  );
  return { buffer: pdf, mimeType: "application/pdf", extension: "pdf" };
};

/** Export label-only file at 300 DPI for physical sticker printing */
const exportLabelOnly = async (userId: string, labelId: string, format: "png" | "pdf" = "pdf") => {
  const label = await SlabLabel.findById(labelId);
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  const requestingUser = await User.findById(userId);
  const isStaff = requestingUser?.role === "admin" || requestingUser?.role === "super_admin";
  if (!isStaff && String(label.user) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "Access denied to this slab label");
  }

  const { report, card, owner } = await loadContext(String(label.user), String(label.report));
  const layout = computeLayout(label as ISlabLabel);
  const [qrDataUri, ownerAvatarDataUri] = await Promise.all([
    buildQrDataUri(String(report._id)),
    buildAvatarDataUri(owner?.avatar?.url),
  ]);

  const png = await buildLabelOnlyPng(
    layout,
    buildLabelText(report, card, qrDataUri, owner, ownerAvatarDataUri),
  );

  if (format === "png") return { buffer: png, mimeType: "image/png", extension: "png" };

  const pdf = await buildPdf(png, SLAB_DEFAULTS.labelWidthMm, SLAB_DEFAULTS.labelHeightMm);
  return { buffer: pdf, mimeType: "application/pdf", extension: "pdf" };
};

const getMyLabels = async (userId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ISlabLabel>(
    SlabLabel.find({ user: userId }).populate("report"),
    query,
  );

  const labels = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: labels, meta };
};

const getLabel = async (userId: string, labelId: string) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId }).populate(
    "report",
  );
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");
  return label;
};

export const SlabServices = {
  createLabel,
  renderLabel,
  selectVariant,
  regenerateBackground,
  previewWithGuides,
  exportPrintSlab,
  exportLabelOnly,
  getMyLabels,
  getLabel,
  pixelIdFor,
  verifyUrlFor,
  STYLES: SLAB_STYLES,
};
