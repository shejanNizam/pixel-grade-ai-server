import { PIXEL_VERIFIED_MIN_CONFIDENCE } from "../../constants";
import { GradeLabel } from "../../modules/grading/grading.interface";

/**
 * Vendor-neutral grading contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE TOUCHING THE CONSISTENCY GUARANTEE
 *
 * "The same image always produces the same grade" CANNOT be satisfied by any
 * provider in this folder. Language models are not deterministic, and the
 * sampling knobs that used to approximate determinism are being removed across
 * vendors.
 *
 * Determinism comes entirely from the Redis cache keyed by `imageSetHash` in
 * grading.service.ts. A provider is called at most once per distinct image set;
 * every later request for the same images is served from cache.
 *
 * If someone "optimises" the cache away, the invariant breaks silently — the
 * grade drifts between runs and nothing fails loudly.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export interface GradingInput {
  /** Publicly reachable image URLs (Cloudinary). Front images first. */
  imageUrls: string[];
  cardName?: string;
  cardSet?: string;
}

export interface GradingOutput {
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

/** Every provider implements exactly this. */
export interface IGradingProvider {
  readonly name: string;
  grade(input: GradingInput): Promise<GradingOutput>;
  isConfigured(): boolean;
}

/**
 * The JSON schema the grading provider constrains output to.
 *
 * `additionalProperties: false` plus a fully-populated `required` array is what
 * OpenAI's strict mode demands.
 */
export const gradingSchema = {
  type: "object",
  properties: {
    scoreSurface: {
      type: "number",
      description: "Surface condition 0-10. Scratches, print lines, whitening, gloss.",
    },
    scoreCorners: {
      type: "number",
      description: "Corner sharpness 0-10. Fraying, rounding, dings.",
    },
    scoreEdges: {
      type: "number",
      description: "Edge condition 0-10. Chipping, whitening, nicks.",
    },
    scoreCentering: {
      type: "number",
      description: "Border symmetry 0-10, front and back where both are visible.",
    },
    grade: {
      type: "number",
      description:
        "Overall grade 0-10, one decimal place allowed. Not a plain average — a single severe defect caps the overall grade.",
    },
    gradeLabel: {
      type: "string",
      enum: Object.values(GradeLabel),
      description: "Band matching the numeric grade.",
    },
    confidence: {
      type: "number",
      description:
        "0-100. How reliable this assessment is given image quality, angle, glare, and coverage. Low-resolution or partial views must score low.",
    },
    reasoning: {
      type: "string",
      description:
        "2-4 sentences citing the specific visible defects that drove each sub-score.",
    },
  },
  required: [
    "scoreSurface",
    "scoreCorners",
    "scoreEdges",
    "scoreCentering",
    "grade",
    "gradeLabel",
    "confidence",
    "reasoning",
  ],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You are a professional trading card grader assessing physical condition from photographs.

Grade four dimensions independently, each 0-10:
- Surface: scratches, print lines, whitening, gloss, indentations, stains
- Corners: sharpness, fraying, rounding, dings
- Edges: chipping, whitening, nicks, roughness
- Centering: border symmetry left/right and top/bottom, front and back

The overall grade is NOT the mean of the sub-scores. A single severe defect caps
the overall grade regardless of how clean the other dimensions are — a card with
a crease is not a 9 because three categories look fine.

Confidence reflects how much the IMAGES support a firm judgement, not how good
the card is. Glare, blur, low resolution, a single angle, or a missing back must
produce low confidence even when the visible condition looks pristine. Do not
inflate confidence to seem decisive — a wrong high-confidence grade is worse
than an honest low-confidence one.

Report only what is visible. Never infer condition from the card's identity,
rarity, or market value.`;

export const buildUserPrompt = (input: GradingInput): string =>
  [
    input.cardName ? `Card: ${input.cardName}` : null,
    input.cardSet ? `Set: ${input.cardSet}` : null,
    `Images provided: ${input.imageUrls.length}`,
    "",
    "Grade this card from the images above.",
  ]
    .filter((line) => line !== null)
    .join("\n");

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/**
 * Normalises a provider's parsed JSON into GradingOutput.
 *
 * Clamps rather than trusts: a JSON schema constrains types, not ranges, so a
 * score of 11 or a confidence of 120 would otherwise reach Mongoose and fail
 * with an opaque validation error far from the cause.
 */
export const normalise = (
  parsed: Record<string, unknown>,
  modelVersion: string,
  raw: unknown,
): GradingOutput => ({
  grade: clamp(Number(parsed.grade), 0, 10),
  gradeLabel: parsed.gradeLabel as GradeLabel,
  scoreSurface: clamp(Number(parsed.scoreSurface), 0, 10),
  scoreCorners: clamp(Number(parsed.scoreCorners), 0, 10),
  scoreEdges: clamp(Number(parsed.scoreEdges), 0, 10),
  scoreCentering: clamp(Number(parsed.scoreCentering), 0, 10),
  confidence: clamp(Number(parsed.confidence), 0, 100),
  reasoning: String(parsed.reasoning ?? ""),
  modelVersion,
  raw,
});

/**
 * The Pixel Verified rule, in one place, vendor-independent.
 *
 * Both conditions are server-derived: `source` comes from the stored analysis,
 * `confidence` from the model. Nothing here reads a request body, which is what
 * makes the badge un-forgeable.
 */
export const isPixelVerified = (source: string, confidence: number): boolean =>
  source === "pixelscope" && confidence >= PIXEL_VERIFIED_MIN_CONFIDENCE;
