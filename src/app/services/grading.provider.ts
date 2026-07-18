import Anthropic from "@anthropic-ai/sdk";
import httpStatus from "http-status";
import { configs } from "../config/index";
import { PIXEL_VERIFIED_MIN_CONFIDENCE } from "../constants";
import AppError from "../errorHelpers/AppError";
import { GradeLabel } from "../modules/grading/grading.interface";

/**
 * AI grading provider.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE TOUCHING THE CONSISTENCY GUARANTEE
 *
 * The requirement "the same image always produces the same grade" CANNOT be
 * satisfied by this file. Language models are not deterministic, and the
 * sampling knobs that used to fake determinism (`temperature: 0`) were removed
 * from the current model generation — passing one is a 400.
 *
 * Determinism therefore comes entirely from the Redis cache keyed by
 * `imageSetHash` in grading.service.ts. This provider is called exactly once per
 * distinct image set; every later request for the same images is served from
 * cache and never reaches the model.
 *
 * If someone "optimises" the cache away, the invariant silently breaks — the
 * grade will drift between runs and nothing will fail loudly.
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

/** Mirrors IGradingReport. `strict`-style schema: every field required, no extras. */
const gradingSchema = {
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

const SYSTEM_PROMPT = `You are a professional trading card grader assessing physical condition from photographs.

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

let client: Anthropic | null = null;

const getClient = (): Anthropic => {
  if (!configs.GRADING.anthropic_api_key) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Grading is not configured — ANTHROPIC_API_KEY is missing. See docs/OPEN-QUESTIONS.md.",
    );
  }
  client ??= new Anthropic({ apiKey: configs.GRADING.anthropic_api_key });
  return client;
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * Runs one grading pass. Callers must consult the cache first — see the header.
 */
const grade = async (input: GradingInput): Promise<GradingOutput> => {
  if (input.imageUrls.length === 0) {
    throw new AppError(httpStatus.BAD_REQUEST, "No images to grade");
  }

  const anthropic = getClient();

  const context = [
    input.cardName ? `Card: ${input.cardName}` : null,
    input.cardSet ? `Set: ${input.cardSet}` : null,
    `Images provided: ${input.imageUrls.length}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropic.messages.create({
    model: configs.GRADING.model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // Adaptive thinking: condition assessment benefits from deliberation, and
    // the model decides how much per image set rather than us guessing a budget.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: gradingSchema },
    },
    messages: [
      {
        role: "user",
        content: [
          ...input.imageUrls.map(
            (url) =>
              ({ type: "image", source: { type: "url", url } }) as const,
          ),
          {
            type: "text",
            text: `${context}\n\nGrade this card from the images above.`,
          },
        ],
      },
    ],
  });

  // A safety refusal is a successful HTTP response, not an exception — checking
  // stop_reason before reading content avoids a confusing index error.
  if (response.stop_reason === "refusal") {
    throw new AppError(
      httpStatus.UNPROCESSABLE_ENTITY,
      "The grading model declined to assess these images.",
    );
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned no readable result.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(textBlock.text) as Record<string, unknown>;
  } catch {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Grading model returned malformed JSON.",
    );
  }

  // Clamp rather than trust: the schema constrains types, not ranges, so a
  // score of 11 or a confidence of 120 would otherwise reach the database and
  // fail Mongoose validation with an opaque error.
  return {
    grade: clamp(Number(parsed.grade), 0, 10),
    gradeLabel: parsed.gradeLabel as GradeLabel,
    scoreSurface: clamp(Number(parsed.scoreSurface), 0, 10),
    scoreCorners: clamp(Number(parsed.scoreCorners), 0, 10),
    scoreEdges: clamp(Number(parsed.scoreEdges), 0, 10),
    scoreCentering: clamp(Number(parsed.scoreCentering), 0, 10),
    confidence: clamp(Number(parsed.confidence), 0, 100),
    reasoning: String(parsed.reasoning ?? ""),
    modelVersion: configs.GRADING.model_version,
    raw: response,
  };
};

/**
 * The Pixel Verified rule, in one place.
 *
 * Both conditions must hold, and both are server-derived: `source` comes from
 * the stored analysis, `confidence` from the model. Nothing here reads the
 * request body, which is what makes the badge un-forgeable.
 */
const isPixelVerified = (source: string, confidence: number): boolean =>
  source === "pixelscope" && confidence >= PIXEL_VERIFIED_MIN_CONFIDENCE;

export const GradingProvider = {
  grade,
  isPixelVerified,
};
