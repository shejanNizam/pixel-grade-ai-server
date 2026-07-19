import { Document, Types } from "mongoose";
import { CardGame } from "../card/card.interface";

/** How the images arrived. `pixelscope` is paid-only and is one of the two
 *  conditions for Pixel Verified — a standard scan can never earn the badge. */
export enum UploadSource {
  standard = "standard",
  pixelscope = "pixelscope",
}

export enum ImageSide {
  front = "front",
  back = "back",
}

/** `awaiting_confirmation` is a hard gate, not a UI nicety: grading and slab
 *  generation refuse to run until the user has confirmed the match. */
export enum AnalysisStatus {
  identifying = "identifying",
  awaiting_confirmation = "awaiting_confirmation",
  confirmed = "confirmed",
  graded = "graded",
  failed = "failed",
}

export interface ICardAnalysisInitial {
  _id?: Types.ObjectId;
  user: Types.ObjectId;
  source: UploadSource;
  game: CardGame;
  language?: string;
  /** Hash over the whole image set. This is the grading cache key, and it is
   *  what makes "same image always produces the same grade" true. */
  imageSetHash: string;
  status: AnalysisStatus;
  /** What the identification service suggested. */
  bestMatchCard?: Types.ObjectId;
  /** What the user actually confirmed. Required before grading may start. */
  confirmedCard?: Types.ObjectId;
  /** Retained as training signal: the user rejected the suggested match. */
  wasCorrected: boolean;
  /**
   * A third-party grade the identification service detected on the card, e.g.
   * "PSA 9 MINT" — the photographed card is already slabbed. Carried through to
   * `collection_items.externalGrade` and deliberately never conflated with our
   * own AI grade.
   */
  detectedExternalGrade?: string;
}

export type ICardAnalysis = ICardAnalysisInitial & Document;

/** One row per uploaded image. A standard scan has one per side (front +
 *  back); a PixelScope upload has up to ten per side. Retained permanently as
 *  training data. */
export interface IAnalysisImageInitial {
  _id?: Types.ObjectId;
  analysis: Types.ObjectId;
  /** Cloudinary URL. Never deleted, even when the user deletes their account. */
  imageUrl: string;
  side: ImageSide;
  /** Position within the side, 0-9. */
  slotIndex: number;
  /** Feeds the Pixel Verified threshold check. */
  qualityScore?: number;
}

export type IAnalysisImage = IAnalysisImageInitial & Document;

/** Alternative matches offered to the user at the confirmation step. */
export interface ICardCandidateInitial {
  _id?: Types.ObjectId;
  analysis: Types.ObjectId;
  card: Types.ObjectId;
  /** 0 = best match. `rank` is the orderable field; `matchScore` is raw. */
  rank: number;
  /**
   * The identification vendor's raw confidence, stored verbatim. Scrydex's
   * scale runs roughly 0.7–1.3+ and is unbounded above — it is NOT a
   * percentage. Use it for ordering; do not render it as "N% match".
   */
  matchScore: number;
}

export type ICardCandidate = ICardCandidateInitial & Document;
