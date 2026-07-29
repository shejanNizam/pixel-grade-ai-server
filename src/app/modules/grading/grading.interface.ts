import { Document, Types } from "mongoose";

/** Human-readable band shown next to the numeric grade. */
export enum GradeLabel {
  PR = "PR",
  FR = "FR",
  GOOD = "GOOD",
  VG = "VG",
  EX = "EX",
  NM = "NM",
  "NM-MT" = "NM-MT",
  MINT = "MINT",
  "GEM-MT" = "GEM-MT",
}

/** Retained permanently — reports are the primary training data, which is why
 *  the raw model output is kept alongside the parsed scores. */
export interface IGradingReportInitial {
  _id?: Types.ObjectId;
  /** One report per analysis. */
  analysis: Types.ObjectId;
  user: Types.ObjectId;
  card: Types.ObjectId;
  /** 0-10, decimals allowed (e.g. 9.5). */
  grade: number;
  gradeLabel: GradeLabel;
  scoreSurface: number;
  scoreCorners: number;
  scoreEdges: number;
  scoreCentering: number;
  /** 0-100 %. At or above PIXEL_VERIFIED_MIN_CONFIDENCE this is half the badge
   *  test; the other half is that the upload came through PixelScope. */
  confidence: number;
  reasoning?: string;
  /** Assessment of the photographs, made before the card was graded. Confidence
   *  tracks this — it is what separates "bad photo" from "bad card". */
  imageQuality?: {
    score: number;
    issues: string[];
  };
  /** Measured front border ratios, as percentages of the total border on each
   *  axis. 50/50 is perfectly centred. Backs the centering sub-score with a
   *  number the user can check rather than an impression. */
  centering?: {
    leftPct: number;
    topPct: number;
  };
  /** Every defect the model found, itemised. Each sub-score below 10 should be
   *  explained by at least one entry here. */
  detectedDefects?: {
    category: string;
    severity: string;
    location: string;
    description: string;
  }[];
  /** SERVER-SET ONLY. Never accept this from a client payload. */
  pixelVerified: boolean;
  /** Which model produced the grade — required to interpret old reports after
   *  a model upgrade, and to re-grade a cohort consistently. */
  modelVersion: string;
  /** Retained verbatim: the parsed scores above are lossy, and re-training or
   *  auditing a disputed grade needs what the model actually returned. */
  rawOutput?: unknown;
  /** Watermarked for Free, clean for paid tiers. */
  reportPdfUrl?: string;
}

export type IGradingReport = IGradingReportInitial & Document;
