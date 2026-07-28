import { model, Schema } from "mongoose";
import { CardGame } from "../card/card.interface";
import {
  AnalysisStatus,
  IAnalysisImage,
  ICardAnalysis,
  ICardCandidate,
  ImageSide,
  UploadSource,
} from "./analysis.interface";

export const cardAnalysisSchema = new Schema<ICardAnalysis>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: {
      type: String,
      enum: Object.values(UploadSource),
      default: UploadSource.standard,
    },
    game: {
      type: String,
      enum: Object.values(CardGame),
      default: CardGame.pokemon,
    },
    language: { type: String },
    imageSetHash: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(AnalysisStatus),
      default: AnalysisStatus.identifying,
    },
    clientRequestId: { type: String },
    bestMatchCard: { type: Schema.Types.ObjectId, ref: "Card" },
    confirmedCard: { type: Schema.Types.ObjectId, ref: "Card" },
    wasCorrected: { type: Boolean, default: false },
    detectedExternalGrade: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

cardAnalysisSchema.index({ user: 1, createdAt: -1 });
// Not unique: two users may legitimately scan identical images, and each needs
// their own analysis. The grading *cache* dedupes on this hash, not the record.
cardAnalysisSchema.index({ imageSetHash: 1 });
cardAnalysisSchema.index({ status: 1 });
// Idempotency. Scoped to the user so two accounts can never collide on a
// guessed key, and partial so the many older rows without one do not all
// collide on `null`.
cardAnalysisSchema.index(
  { user: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: "string" } },
  },
);
// Drives the abandoned-scan sweeper, which scans by status and age.
cardAnalysisSchema.index({ status: 1, createdAt: 1 });

export const CardAnalysis = model<ICardAnalysis>(
  "CardAnalysis",
  cardAnalysisSchema,
);

export const analysisImageSchema = new Schema<IAnalysisImage>(
  {
    analysis: {
      type: Schema.Types.ObjectId,
      ref: "CardAnalysis",
      required: true,
    },
    imageUrl: { type: String, required: true },
    side: {
      type: String,
      enum: Object.values(ImageSide),
      default: ImageSide.front,
    },
    slotIndex: { type: Number, default: 0, min: 0, max: 9 },
    qualityScore: { type: Number, min: 0, max: 100 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

analysisImageSchema.index({ analysis: 1 });

export const AnalysisImage = model<IAnalysisImage>(
  "AnalysisImage",
  analysisImageSchema,
);

export const cardCandidateSchema = new Schema<ICardCandidate>(
  {
    analysis: {
      type: Schema.Types.ObjectId,
      ref: "CardAnalysis",
      required: true,
    },
    card: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    rank: { type: Number, required: true, min: 0 },
    // Vendor-defined scale, NOT a percentage. Scrydex returns roughly 0.7–1.3+
    // and it is not bounded at 1 — an upper limit here would reject good
    // matches, so only the lower bound is enforced.
    matchScore: { type: Number, required: true, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// Candidates are always read as an ordered list for one analysis.
cardCandidateSchema.index({ analysis: 1, rank: 1 });

export const CardCandidate = model<ICardCandidate>(
  "CardCandidate",
  cardCandidateSchema,
);
