import httpStatus from "http-status";
import { REDIS_KEYS } from "../../constants";
import { configs } from "../../config/index";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import { GradingProvider } from "../../services/grading/index";
import type {
  CenteringMeasurement,
  DetectedDefect,
  ImageQuality,
} from "../../services/grading/grading.types";
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
  /** Present from pixelgrade-v2 onward. Optional because entries written by an
   *  earlier version are still valid cache hits for their own model version —
   *  the version is part of the key, so a v1 entry can only ever serve a v1
   *  request. */
  imageQuality?: ImageQuality;
  centering?: CenteringMeasurement;
  detectedDefects?: DetectedDefect[];
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
  // A canceled or failed scan has already had its credits returned. Grading it
  // now would hand out a report nobody paid for.
  if (
    analysis.status === AnalysisStatus.canceled ||
    analysis.status === AnalysisStatus.failed
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This scan was canceled and its credits refunded. Start a new scan to grade this card.",
    );
  }
  if (analysis.status === AnalysisStatus.graded) {
    const existing = await GradingReport.findOne({
      analysis: analysis._id,
    }).populate("card");
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
    try {
      const fresh = await GradingProvider.grade({
        imageUrls: images.map((i) => i.imageUrl),
        cardName: card?.name,
        cardSet: card?.setExpansion,
        source: analysis.source,
      });
      result = fresh;
      await writeCache(key, fresh);
    } catch (error) {
      // The scan was paid for at identification, but the invariant the credits
      // express is "10 credits per finished report" — and this one produced
      // none. Refund here rather than in the cancel path, because only here is
      // it certain the model never returned: a cancel racing an in-flight
      // grade could otherwise refund a scan that is about to succeed.
      analysis.status = AnalysisStatus.failed;
      await analysis.save();

      try {
        await CreditServices.refundScan(userId, analysis._id);
      } catch (refundError) {
        // Never mask the grading failure with a refund failure, but never lose
        // it either — the sweeper does not cover confirmed scans, so an
        // unlogged failure here is credits silently gone.
        logger.error("Failed to refund credits after a failed grade", {
          analysisId: String(analysis._id),
          userId,
          error: refundError,
        });
      }

      throw error;
    }
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
    imageQuality: result.imageQuality,
    centering: result.centering,
    detectedDefects: result.detectedDefects,
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

  // Populated on the way out: the result screen shows the card's name, number,
  // and set alongside the grade, and a bare ObjectId would leave it with
  // nothing to render but the grade band.
  return report.populate("card");
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

/**
 * Resolves the Pixel ID printed on a slab to a PUBLIC, view-only summary.
 *
 * This is what the band's QR code points at, so it is deliberately
 * unauthenticated — anyone handed the physical slab can check that the grade on
 * it was really issued by us. That makes the shape of the response the whole
 * security boundary:
 *
 *   • It is a fixed projection, never the report document. The raw model
 *     output, the reasoning, the analysis, and the owner's email are all
 *     training/internal data and must not appear here.
 *   • It exposes the owner's `username` — the public handle already printed on
 *     the band beside their avatar — and never the email behind it.
 *   • It answers only for an exact Pixel ID. There is no listing endpoint, so
 *     the ids cannot be enumerated without the slabs.
 *
 * Widening this projection is a privacy decision, not a formatting one.
 */
const verifyByPixelId = async (rawPixelId: string) => {
  // The printed form is `PG-` + the last 10 hex chars of the report id,
  // upper-cased. Accept it with or without the prefix and in any case.
  const suffix = rawPixelId
    .trim()
    .replace(/^PG-/i, "")
    .toLowerCase();

  if (!/^[0-9a-f]{10}$/.test(suffix)) {
    throw new AppError(httpStatus.BAD_REQUEST, "That is not a valid Pixel ID.");
  }

  // The id is a SUFFIX of the ObjectId, so the full id can't be reconstructed —
  // the last 10 of the 24 hex characters have to be matched server-side.
  const matches = await GradingReport.find({
    $expr: {
      $eq: [{ $substrCP: [{ $toString: "$_id" }, 14, 10] }, suffix],
    },
  })
    .populate("card")
    .populate("user", "username avatar")
    .limit(2);

  if (matches.length === 0) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "No graded card matches that Pixel ID.",
    );
  }

  // 10 hex characters make this effectively impossible, but returning an
  // arbitrary one of two reports would be a wrong answer presented as a
  // verification. Refuse instead.
  if (matches.length > 1) {
    logger.error("Pixel ID collision", { suffix });
    throw new AppError(
      httpStatus.CONFLICT,
      "That Pixel ID is ambiguous. Please contact support.",
    );
  }

  const report = matches[0];
  const card = report.card as unknown as ReportCardInfo & {
    language?: string;
    releaseYear?: number;
    officialImageUrl?: string;
  };
  const owner = report.user as unknown as {
    username?: string;
    avatar?: { url?: string };
  };
  // `timestamps: true` on the schema; IGradingReport doesn't declare them.
  const { createdAt } = report as unknown as { createdAt?: Date };

  return {
    pixelId: `PG-${suffix.toUpperCase()}`,
    grade: report.grade,
    gradeLabel: report.gradeLabel,
    confidence: report.confidence,
    pixelVerified: report.pixelVerified,
    scores: {
      surface: report.scoreSurface,
      corners: report.scoreCorners,
      edges: report.scoreEdges,
      centering: report.scoreCentering,
    },
    card: {
      name: card?.name,
      setExpansion: card?.setExpansion,
      cardNumber: card?.cardNumber,
      rarity: card?.rarity,
      language: card?.language,
      releaseYear: card?.releaseYear,
      officialImageUrl: card?.officialImageUrl,
    },
    owner: {
      username: owner?.username,
      avatarUrl: owner?.avatar?.url,
    },
    gradedAt: createdAt,
    modelVersion: report.modelVersion,
  };
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
  verifyByPixelId,
};
