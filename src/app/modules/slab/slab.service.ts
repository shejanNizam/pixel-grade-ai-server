import httpStatus from "http-status";
import { Types } from "mongoose";
import { uploadBufferToCloudinary } from "../../config/cloudinary.config";
import { SlabStyle, SLAB_STYLES } from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { ImageGenProvider } from "../../services/imagegen.provider";
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
 * Certificate number, derived from the report id.
 *
 * Deterministic on purpose — the same report always prints the same cert, so a
 * regenerated or re-exported label stays verifiable against the original.
 */
const certNumberFor = (reportId: string): string =>
  `PG-${reportId.slice(-10).toUpperCase()}`;

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
): LabelText => ({
  cardName: card.name,
  setExpansion: card.setExpansion,
  cardNumber: card.cardNumber,
  language: card.language,
  grade: report.grade,
  gradeLabel: report.gradeLabel,
  // Read from the stored report, which the grading service set server-side.
  pixelVerified: report.pixelVerified,
  certNumber: certNumberFor(String(report._id)),
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
  const backgroundUrl =
    label.backgroundUrl ??
    (await ImageGenProvider.generateBackground(
      label.styleId,
      layout.canvasWidth,
      layout.canvasHeight,
    ));

  const cardImageUrl = await resolveCardImageUrl(
    report.analysis,
    card.officialImageUrl,
  );

  const [backgroundBuffer, cardBuffer] = await Promise.all([
    fetchBuffer(backgroundUrl),
    fetchBuffer(cardImageUrl),
  ]);

  const png = await compositePng(
    layout,
    backgroundBuffer,
    cardBuffer,
    buildLabelText(report, card),
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
  certNumberFor,
  STYLES: SLAB_STYLES,
};
