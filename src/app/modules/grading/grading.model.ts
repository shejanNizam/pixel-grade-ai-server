import { model, Schema } from "mongoose";
import { GradeLabel, IGradingReport } from "./grading.interface";

const subScore = { type: Number, required: true, min: 0, max: 10 };

export const gradingReportSchema = new Schema<IGradingReport>(
  {
    analysis: {
      type: Schema.Types.ObjectId,
      ref: "CardAnalysis",
      required: true,
      unique: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    card: { type: Schema.Types.ObjectId, ref: "Card", required: true },
    grade: { type: Number, required: true, min: 0, max: 10 },
    gradeLabel: {
      type: String,
      enum: Object.values(GradeLabel),
      required: true,
    },
    scoreSurface: subScore,
    scoreCorners: subScore,
    scoreEdges: subScore,
    scoreCentering: subScore,
    confidence: { type: Number, required: true, min: 0, max: 100 },
    reasoning: { type: String },
    // All three are optional so reports written before pixelgrade-v2 still
    // load. Nothing back-fills them — an old report keeps the grade it was
    // issued with, and the UI degrades to the v1 layout when they are absent.
    imageQuality: {
      type: new Schema(
        {
          score: { type: Number, min: 0, max: 100 },
          issues: { type: [String], default: [] },
        },
        { _id: false },
      ),
      required: false,
    },
    centering: {
      type: new Schema(
        {
          leftPct: { type: Number, min: 0, max: 100 },
          topPct: { type: Number, min: 0, max: 100 },
        },
        { _id: false },
      ),
      required: false,
    },
    detectedDefects: {
      type: [
        new Schema(
          {
            category: { type: String },
            severity: { type: String },
            location: { type: String },
            description: { type: String },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    // Server-set only. There is deliberately no validation path that accepts
    // this from a request body — see the grading service.
    pixelVerified: { type: Boolean, default: false },
    modelVersion: { type: String, required: true },
    rawOutput: { type: Schema.Types.Mixed },
    reportPdfUrl: { type: String },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

gradingReportSchema.index({ user: 1, createdAt: -1 });
gradingReportSchema.index({ card: 1 });

export const GradingReport = model<IGradingReport>(
  "GradingReport",
  gradingReportSchema,
);
