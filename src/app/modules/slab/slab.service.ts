import httpStatus from "http-status";
import { Types } from "mongoose";
import QRCode from "qrcode";
import { uploadBufferToCloudinary } from "../../config/cloudinary.config";
import { configs } from "../../config/index";
import { SlabStyle, SLAB_STYLES } from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { ImageGenProvider } from "../../services/imagegen.provider";
import { logger } from "../../utils/logger";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { AnalysisImage } from "../analysis/analysis.model";
import { ImageSide } from "../analysis/analysis.interface";
import { Card } from "../card/card.model";
import { GradingReport } from "../grading/grading.model";
import { buildPdf, compositePng, LabelText } from "./slab.composite";
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

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      `Could not fetch asset (${response.status}): ${url}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
};

/**
 * The card image shown in the window.
 *
 * Prefers the user's own front photo — a slab shows the card that was actually
 * graded, not a stock product shot. Falls back to the catalogue image only when
 * the scan has no front image (possible for a back-only PixelScope upload).
 */
const resolveCardImageUrl = async (
  analysisId: Types.ObjectId,
  officialImageUrl?: string,
): Promise<string> => {
  const front = await AnalysisImage.findOne({
    analysis: analysisId,
    side: ImageSide.front,
  }).sort({ slotIndex: 1 });

  const url = front?.imageUrl ?? officialImageUrl;
  if (!url) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "No card image is available for this report.",
    );
  }
  return url;
};

/** Loads the report plus the joined data the label needs. */
const loadContext = async (userId: string, reportId: string) => {
  const report = await GradingReport.findOne({ _id: reportId, user: userId });
  if (!report) {
    throw new AppError(httpStatus.NOT_FOUND, "Grading report not found");
  }

  const card = await Card.findById(report.card);
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");

  return { report, card };
};

const buildLabelText = (
  report: Awaited<ReturnType<typeof loadContext>>["report"],
  card: Awaited<ReturnType<typeof loadContext>>["card"],
  qrDataUri?: string,
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
 * Split out from `createLabel` so regenerate and export reuse the exact same
 * pipeline — there is only one place where pixels are produced.
 */
const renderLabel = async (userId: string, labelId: string) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  const { report, card } = await loadContext(userId, String(label.report));

  const layout = computeLayout(label as ISlabLabel);

  // Only the background is generated. Everything else is drawn by us.
  //
  // The card's own palette/setting is passed as art direction so the backdrop
  // reads as an extension of the card rather than a generic swatch (client
  // feedback 2026-07-29). It steers colour and mood only — the provider still
  // refuses to render creatures, text, or anything resembling the card art
  // itself, which would be a derivative of the publisher's copyrighted work.
  const backgroundUrl =
    label.backgroundUrl ??
    (await ImageGenProvider.generateBackground(
      label.styleId,
      layout.canvasWidth,
      layout.canvasHeight,
      { cardName: card.name, setExpansion: card.setExpansion },
    ));

  const cardImageUrl = await resolveCardImageUrl(
    report.analysis,
    card.officialImageUrl,
  );

  const [backgroundBuffer, cardBuffer, qrDataUri] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(cardImageUrl),
    buildQrDataUri(String(report._id)),
  ]);

  const png = await compositePng(
    layout,
    backgroundBuffer,
    cardBuffer,
    buildLabelText(report, card, qrDataUri),
  );
  const pdf = await buildPdf(png, label.widthMm + label.bleedMm * 2, label.heightMm + label.bleedMm * 2);

  const [pngUpload, pdfUpload] = await Promise.all([
    uploadBufferToCloudinary(png, `slab-${labelId}-v${label.version}`),
    uploadBufferToCloudinary(pdf, `slab-${labelId}-v${label.version}-pdf`),
  ]);

  label.backgroundUrl = backgroundUrl;
  label.compositeUrl = pngUpload?.secure_url;
  label.exportPngUrl = pngUpload?.secure_url;
  label.exportPdfUrl = pdfUpload?.secure_url;
  await label.save();

  return label;
};

/**
 * Replaces the background with fresh artwork and re-composites.
 *
 * Bumps `version` and keeps the previous export URLs in history rather than
 * overwriting silently — labels are retained permanently and must stay
 * regenerable from the collection.
 */
const regenerateBackground = async (
  userId: string,
  labelId: string,
  styleId?: SlabStyle,
) => {
  const label = await SlabLabel.findOne({ _id: labelId, user: userId });
  if (!label) throw new AppError(httpStatus.NOT_FOUND, "Slab label not found");

  if (styleId) label.styleId = styleId;
  // Clearing this forces the provider to be called again on the next render.
  label.backgroundUrl = undefined;
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

  const { report, card } = await loadContext(userId, String(label.report));
  const layout = computeLayout(label as ISlabLabel);

  const [backgroundBuffer, cardBuffer] = await Promise.all([
    fetchBuffer(label.backgroundUrl),
    fetchBuffer(await resolveCardImageUrl(report.analysis, card.officialImageUrl)),
  ]);

  return compositePng(
    layout,
    backgroundBuffer,
    cardBuffer,
    buildLabelText(report, card),
    { showGuides: true },
  );
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
  regenerateBackground,
  previewWithGuides,
  getMyLabels,
  getLabel,
  pixelIdFor,
  verifyUrlFor,
  STYLES: SLAB_STYLES,
};
