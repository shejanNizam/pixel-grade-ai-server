import httpStatus from "http-status";
import { REDIS_KEYS } from "../../constants";
import { configs } from "../../config/index";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import { GradingProvider } from "../../services/grading/index";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { AnalysisStatus } from "../analysis/analysis.interface";
import { AnalysisImage, CardAnalysis } from "../analysis/analysis.model";
import { Card } from "../card/card.model";
import { CreditServices } from "../credit/credit.service";
import { buildReportPdf, ReportCardInfo } from "./grading.pdf";
import { NotifType } from "../notification/notification.interface";
import { NotificationServices } from "../notification/notification.service";
import { UserRole } from "../user/user.interface";
import { GradeLabel, IGradingReport } from "./grading.interface";
import { GradingReport } from "./grading.model";

/**
 * Cached grading result. Only the model's own output is cached — never the
 * derived `pixelVerified` flag, which depends on the *upload mode* of the
 * specific analysis. Two users can scan identical images, one via PixelScope
 * and one via a standard scan; caching the badge would leak it to the free one.
 */
interface CachedGrade {
  grade: number;
  gradeLabel: GradeLabel;
  scoreSurface: number;
  scoreCorners: number;
  scoreEdges: number;
  scoreCentering: number;
  confidence: number;
  reasoning: string;
  modelVersion: string;
  raw: unknown;
}

/** Cache key includes the model version, so a model upgrade re-grades rather
 *  than serving stale results produced by a different model. */
const cacheKey = (imageSetHash: string, modelVersion: string) =>
  `${REDIS_KEYS.gradingResult}${modelVersion}:${imageSetHash}`;

const readCache = async (key: string): Promise<CachedGrade | null> => {
  try {
    const hit = await redisClient.get(key);
    return hit ? (JSON.parse(hit) as CachedGrade) : null;
  } catch (error) {
    // A cache outage must not block grading — it costs consistency for this one
    // request, which is strictly better than refusing to grade at all.
    logger.error("Grading cache read failed", { key, error });
    return null;
  }
};

const writeCache = async (key: string, value: CachedGrade) => {
  try {
    // No TTL: the consistency guarantee is "the same images always produce the
    // same grade", which an expiring key would quietly break.
    await redisClient.set(key, JSON.stringify(value));
  } catch (error) {
    logger.error("Grading cache write failed", { key, error });
  }
};

/**
 * Grades a confirmed analysis.
 *
 * The repeatability invariant lives here, not in the model: identical image sets
 * resolve to the same `imageSetHash`, hit the cache, and replay the original
 * scores. The provider is called at most once per distinct image set.
 */
const gradeAnalysis = async (userId: string, analysisId: string) => {
  const analysis = await CardAnalysis.findOne({
    _id: analysisId,
    user: userId,
  });
  if (!analysis) throw new AppError(httpStatus.NOT_FOUND, "Analysis not found");

  // Hard gate #3: no confirmation, no grade.
  if (!analysis.confirmedCard) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Confirm the card match before grading.",
    );
  }
  if (analysis.status === AnalysisStatus.graded) {
    const existing = await GradingReport.findOne({ analysis: analysis._id });
    if (existing) return existing;
  }

  const images = await AnalysisImage.find({ analysis: analysis._id }).sort({
    side: 1,
    slotIndex: 1,
  });
  if (images.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "This scan has no images.");
  }

  const card = await Card.findById(analysis.confirmedCard);
  const key = cacheKey(analysis.imageSetHash, configs.GRADING.model_version);

  let result = await readCache(key);

  if (!result) {
    const fresh = await GradingProvider.grade({
      imageUrls: images.map((i) => i.imageUrl),
      cardName: card?.name,
      cardSet: card?.setExpansion,
    });
    result = fresh;
    await writeCache(key, fresh);
  }

  // Server-derived, from the stored analysis and the model's confidence. The
  // request body is never consulted.
  const pixelVerified = GradingProvider.isPixelVerified(
    analysis.source,
    result.confidence,
  );

  const report = await GradingReport.create({
    analysis: analysis._id,
    user: userId,
    card: analysis.confirmedCard,
    grade: result.grade,
    gradeLabel: result.gradeLabel,
    scoreSurface: result.scoreSurface,
    scoreCorners: result.scoreCorners,
    scoreEdges: result.scoreEdges,
    scoreCentering: result.scoreCentering,
    confidence: result.confidence,
    reasoning: result.reasoning,
    pixelVerified,
    modelVersion: result.modelVersion,
    rawOutput: result.raw,
  });

  analysis.status = AnalysisStatus.graded;
  await analysis.save();

  await NotificationServices.create(
    userId,
    NotifType.grade_ready,
    "Your grading report is ready",
    `${card?.name ?? "Your card"} graded ${result.grade} (${result.gradeLabel}).`,
  );

  return report;
};

const getMyReports = async (userId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<IGradingReport>(
    GradingReport.find({ user: userId }).populate("card"),
    query,
  );

  const reports = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: reports, meta };
};

/** Admins may read any report; users only their own. */
const getReport = async (reportId: string, userId: string, role: string) => {
  const report = await GradingReport.findById(reportId)
    .populate("card")
    .populate("analysis");
  if (!report) throw new AppError(httpStatus.NOT_FOUND, "Report not found");

  const isStaff = role === UserRole.admin || role === UserRole.super_admin;
  if (!isStaff && String(report.user) !== userId) {
    throw new AppError(httpStatus.FORBIDDEN, "You are not authorized");
  }

  return report;
};

const getAllReports = async (query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<IGradingReport>(
    GradingReport.find().populate("card").populate("user", "name email"),
    query,
  );

  const reports = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: reports, meta };
};

/** Whether this user's plan gets a clean PDF or a watermarked one. */
const shouldWatermark = async (userId: string): Promise<boolean> => {
  const plan = await CreditServices.resolvePlan(userId);
  return plan.watermarkReports;
};

/**
 * Renders the report as a PDF, watermarked per the OWNER's plan — not the
 * requester's, so an admin downloading a Free user's report sees exactly what
 * that user would. Rendered fresh on every download rather than cached: the
 * watermark must track the owner's current plan, and a stored file would
 * fossilise whichever plan they had when it was first generated.
 */
const getReportPdf = async (reportId: string, userId: string, role: string) => {
  const report = await getReport(reportId, userId, role);
  const watermark = await shouldWatermark(String(report.user));
  const card = report.card as unknown as ReportCardInfo;
  const pdf = await buildReportPdf(report, card ?? {}, watermark);
  return { pdf, reportId: String(report._id) };
};

export const GradingServices = {
  gradeAnalysis,
  getMyReports,
  getReport,
  getAllReports,
  shouldWatermark,
  getReportPdf,
};
