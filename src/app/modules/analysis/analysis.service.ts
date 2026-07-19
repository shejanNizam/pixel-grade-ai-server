import crypto from "crypto";
import httpStatus from "http-status";
import {
  PIXELSCOPE_MAX_IMAGES_PER_SIDE,
  REDIS_KEYS,
  STANDARD_MAX_IMAGES_PER_SIDE,
} from "../../constants";
import { redisClient } from "../../config/redis.config";
import AppError from "../../errorHelpers/AppError";
import {
  IdentificationProvider,
  IdentificationResult,
} from "../../services/identification.provider";
import { QueryBuilder } from "../../utils/QueryBuilder";
import { logger } from "../../utils/logger";
import { CardGame } from "../card/card.interface";
import { CardServices } from "../card/card.service";
import { CreditServices } from "../credit/credit.service";
import {
  AnalysisStatus,
  ICardAnalysis,
  ImageSide,
  UploadSource,
} from "./analysis.interface";
import { AnalysisImage, CardAnalysis, CardCandidate } from "./analysis.model";

export interface UploadedImage {
  imageUrl: string;
  side: ImageSide;
  slotIndex: number;
}

/**
 * Stable fingerprint of an image set. Sorted before hashing so the same photos
 * uploaded in a different order still hit the same grading cache entry — order
 * is not part of the card's identity.
 */
const computeImageSetHash = (images: UploadedImage[]): string => {
  const canonical = images
    .map((i) => `${i.side}:${i.slotIndex}:${i.imageUrl}`)
    .sort()
    .join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
};

/**
 * Identification cache — saves Scrydex credits (5 per Vision call), not time.
 *
 * Keyed by the exact input the vendor sees: the FIRST image's URL plus the
 * game (identification deliberately sends one image — see the provider's cost
 * note). This dedupes retries and resubmissions of the same upload. It does
 * NOT dedupe a fresh upload of the same photo — Cloudinary mints a new URL per
 * upload, so the key differs; content-hash keying would require downloading
 * every image, which costs more than it saves at current volume.
 *
 * 30-day TTL: long enough that retry storms and re-scans stay free, short
 * enough that catalogue corrections at Scrydex eventually propagate.
 *
 * Fail-open like the grading cache: a Redis outage must never block a scan —
 * it just costs vendor credits for the duration.
 */
const IDENT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;

const identCacheKey = (imageUrl: string, game: CardGame): string =>
  `${REDIS_KEYS.identification}${game}:${crypto
    .createHash("sha256")
    .update(imageUrl)
    .digest("hex")}`;

const readIdentCache = async (
  key: string,
): Promise<IdentificationResult | null> => {
  try {
    const hit = await redisClient.get(key);
    return hit ? (JSON.parse(hit) as IdentificationResult) : null;
  } catch (error) {
    logger.error("Identification cache read failed", { key, error });
    return null;
  }
};

const writeIdentCache = async (
  key: string,
  result: IdentificationResult,
): Promise<void> => {
  try {
    await redisClient.set(key, JSON.stringify(result), {
      EX: IDENT_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    logger.error("Identification cache write failed", { key, error });
  }
};

/**
 * Enforces the per-mode image limits. Both modes are per-side rules:
 * standard = 1 front + 1 back (the Quick Import screen), PixelScope = up to 10
 * per side. Exported for unit testing — it is the scan flow's front door.
 */
export const validateImageSet = (
  source: UploadSource,
  images: UploadedImage[],
) => {
  if (images.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "At least one image is required.");
  }

  const perSide = { front: 0, back: 0 };
  for (const image of images) {
    perSide[image.side] += 1;
  }

  const maxPerSide =
    source === UploadSource.standard
      ? STANDARD_MAX_IMAGES_PER_SIDE
      : PIXELSCOPE_MAX_IMAGES_PER_SIDE;

  if (perSide.front > maxPerSide || perSide.back > maxPerSide) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      source === UploadSource.standard
        ? "A standard scan accepts one front and one back image. Use PixelScope for multi-image uploads."
        : `PixelScope accepts at most ${PIXELSCOPE_MAX_IMAGES_PER_SIDE} images per side.`,
    );
  }
};

/**
 * Starts a scan: stores the images, debits credits, then identifies.
 *
 * Ordering matters. The debit happens AFTER the upload is persisted but BEFORE
 * the vendor call, so a user is never charged for a request that failed during
 * upload, and a vendor failure refunds rather than silently keeping the credits.
 *
 * `requireCredits` middleware has already rejected the obvious no-balance case;
 * the debit here is the authoritative one and is atomic (see credit.service).
 */
const createAnalysis = async (
  userId: string,
  payload: {
    source: UploadSource;
    game: CardGame;
    language?: string;
    images: UploadedImage[];
  },
) => {
  validateImageSet(payload.source, payload.images);

  const imageSetHash = computeImageSetHash(payload.images);

  const analysis = await CardAnalysis.create({
    user: userId,
    source: payload.source,
    game: payload.game,
    language: payload.language,
    imageSetHash,
    status: AnalysisStatus.identifying,
  });

  await AnalysisImage.insertMany(
    payload.images.map((image) => ({ ...image, analysis: analysis._id })),
  );

  await CreditServices.spendForScan(userId, analysis._id);

  try {
    // Identification sends only the first image, so that is what keys the
    // cache. A hit costs zero Scrydex credits; the user's own scan debit above
    // stands either way — they are paying for the scan, not the vendor call.
    // validateImageSet guarantees at least one image, so this never falls back.
    const cacheKey = identCacheKey(
      payload.images[0]?.imageUrl ?? "",
      payload.game,
    );

    let result = await readIdentCache(cacheKey);
    if (!result) {
      result = await IdentificationProvider.identify(
        payload.images.map((i) => i.imageUrl),
        payload.game,
      );
      // Empty results are not cached: a transient vendor hiccup should not
      // pin "no match" onto this image for a month.
      if (result.candidates.length > 0) {
        await writeIdentCache(cacheKey, result);
      }
    }

    if (result.candidates.length === 0) {
      analysis.status = AnalysisStatus.failed;
      await analysis.save();
      throw new AppError(
        httpStatus.NOT_FOUND,
        "No matching card was found for these images.",
      );
    }

    // Cache every candidate into the catalogue so the confirmation screen and
    // any later collection entry can reference a real card document.
    const cards = await Promise.all(
      result.candidates.map((c) => CardServices.upsertByScrydexId(c)),
    );

    await CardCandidate.insertMany(
      cards.map((card, index) => ({
        analysis: analysis._id,
        card: card?._id,
        rank: index,
        matchScore: result.candidates[index]?.matchScore ?? 0,
      })),
    );

    analysis.bestMatchCard = cards[0]?._id;
    // Scrydex reports the language it detected, which is more reliable than
    // whatever the user selected in the dropdown.
    if (result.languageCode && !analysis.language) {
      analysis.language = result.languageCode;
    }
    // The card is already in a third-party slab. Kept distinct from our AI
    // grade — it becomes `collection_items.externalGrade`, never our grade.
    if (result.gradedDetails?.company) {
      analysis.detectedExternalGrade = [
        result.gradedDetails.company,
        result.gradedDetails.gradeNumber,
        result.gradedDetails.gradeLabel,
      ]
        .filter(Boolean)
        .join(" ");
    }
    analysis.status = AnalysisStatus.awaiting_confirmation;
    await analysis.save();

    return analysis;
  } catch (error) {
    // The scan never produced a usable result, so the credits go back. The
    // images and the analysis row are kept — failed identifications are still
    // training data.
    analysis.status = AnalysisStatus.failed;
    await analysis.save();

    try {
      await CreditServices.refundScan(userId, analysis._id);
    } catch (refundError) {
      // Never mask the original failure with a refund failure — but do not
      // lose it either, or the user is silently out of pocket.
      logger.error("Failed to refund credits after a failed scan", {
        analysisId: String(analysis._id),
        userId,
        error: refundError,
      });
    }

    throw error;
  }
};

/**
 * The mandatory confirmation gate.
 *
 * Nothing downstream — grading, slab generation, collection — may proceed until
 * this has run. `wasCorrected` is retained permanently: a user rejecting the
 * suggested match is exactly the signal a future in-house model needs.
 */
const confirmCard = async (
  userId: string,
  analysisId: string,
  cardId: string,
) => {
  const analysis = await CardAnalysis.findOne({
    _id: analysisId,
    user: userId,
  });
  if (!analysis) throw new AppError(httpStatus.NOT_FOUND, "Analysis not found");

  if (analysis.status === AnalysisStatus.graded) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "This scan has already been graded and cannot be re-confirmed.",
    );
  }
  if (analysis.status !== AnalysisStatus.awaiting_confirmation) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `This scan is not awaiting confirmation (status: ${analysis.status}).`,
    );
  }

  // The confirmed card must be one the system actually offered. Without this a
  // client could attach any card in the catalogue to its own images.
  const candidate = await CardCandidate.findOne({
    analysis: analysis._id,
    card: cardId,
  });
  if (!candidate) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "That card was not among the suggested matches for this scan.",
    );
  }

  analysis.confirmedCard = candidate.card;
  analysis.wasCorrected =
    String(analysis.bestMatchCard) !== String(candidate.card);
  analysis.status = AnalysisStatus.confirmed;
  await analysis.save();

  return analysis;
};

const getMyAnalyses = async (userId: string, query: Record<string, string>) => {
  const queryBuilder = new QueryBuilder<ICardAnalysis>(
    CardAnalysis.find({ user: userId })
      .populate("bestMatchCard")
      .populate("confirmedCard"),
    query,
  );

  const analyses = await queryBuilder.filter().sort().paginate().build();
  const meta = await queryBuilder.getMeta();

  return { data: analyses, meta };
};

/** Full detail: the analysis, its images, and the candidate list. */
const getAnalysis = async (userId: string, analysisId: string) => {
  const analysis = await CardAnalysis.findOne({ _id: analysisId, user: userId })
    .populate("bestMatchCard")
    .populate("confirmedCard");
  if (!analysis) throw new AppError(httpStatus.NOT_FOUND, "Analysis not found");

  const [images, candidates] = await Promise.all([
    AnalysisImage.find({ analysis: analysis._id }).sort({ side: 1, slotIndex: 1 }),
    CardCandidate.find({ analysis: analysis._id })
      .populate("card")
      .sort({ rank: 1 }),
  ]);

  return { analysis, images, candidates };
};

export const AnalysisServices = {
  createAnalysis,
  confirmCard,
  getMyAnalyses,
  getAnalysis,
  computeImageSetHash,
};
