import crypto from "crypto";
import httpStatus from "http-status";
import { PIXELSCOPE_MAX_IMAGES_PER_SIDE, STANDARD_MAX_IMAGES } from "../../constants";
import AppError from "../../errorHelpers/AppError";
import { IdentificationProvider } from "../../services/identification.provider";
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

/** Enforces the per-mode image limits from the requirements. */
const validateImageSet = (source: UploadSource, images: UploadedImage[]) => {
  if (images.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "At least one image is required.");
  }

  if (source === UploadSource.standard) {
    if (images.length > STANDARD_MAX_IMAGES) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        `A standard scan accepts ${STANDARD_MAX_IMAGES} image. Use PixelScope for multi-image uploads.`,
      );
    }
    return;
  }

  const perSide = { front: 0, back: 0 };
  for (const image of images) {
    perSide[image.side] += 1;
  }
  if (
    perSide.front > PIXELSCOPE_MAX_IMAGES_PER_SIDE ||
    perSide.back > PIXELSCOPE_MAX_IMAGES_PER_SIDE
  ) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `PixelScope accepts at most ${PIXELSCOPE_MAX_IMAGES_PER_SIDE} images per side.`,
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
    const result = await IdentificationProvider.identify(
      payload.images.map((i) => i.imageUrl),
      payload.game,
    );

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
