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
  /** Upload source: 'pixelscope' vs 'standard' */
  source?: string;
}

/** Which of the four graded dimensions a defect belongs to. */
export enum DefectCategory {
  surface = "surface",
  corners = "corners",
  edges = "edges",
  centering = "centering",
}

export enum DefectSeverity {
  minor = "minor",
  moderate = "moderate",
  severe = "severe",
}

/** One named, located defect. The client asked for every detected defect to be
 *  listed rather than summarised in prose, so a grade can be argued with. */
export interface DetectedDefect {
  category: DefectCategory;
  severity: DefectSeverity;
  /** Where on the card, in plain words: "upper right corner", "lower third". */
  location: string;
  description: string;
}

/**
 * Image-quality assessment, produced BEFORE the condition grade.
 *
 * Step 1 of the client's recommended workflow. It is also the honest input to
 * `confidence`: a card photographed under glare cannot be graded firmly however
 * pristine it looks, and separating this out stops the model from quietly
 * folding "the photo is bad" into "the card is bad".
 */
export interface ImageQuality {
  /** 0-100. How well these images support a condition judgement. */
  score: number;
  /** Named problems: "glare across holo", "back not supplied", "out of focus". */
  issues: string[];
}

/**
 * Measured border ratios for centering.
 *
 * Reported as percentages of the total border on each axis, so 50/50 is
 * perfectly centred and 60/40 is the PSA-style shorthand collectors expect.
 */
export interface CenteringMeasurement {
  /** Left border as a percentage of left+right. */
  leftPct: number;
  /** Top border as a percentage of top+bottom. */
  topPct: number;
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
  imageQuality: ImageQuality;
  centering: CenteringMeasurement;
  detectedDefects: DetectedDefect[];
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
    imageQuality: {
      type: "object",
      description:
        "Assessment of the PHOTOGRAPHS, made before grading the card itself.",
      properties: {
        score: {
          type: "number",
          description:
            "0-100. How well these images support a condition judgement. Focus, lighting, glare, cropping, coverage.",
        },
        issues: {
          type: "array",
          description:
            "Named image problems, e.g. 'glare across the holo', 'back not supplied', 'soft focus at the left edge'. Empty when the images are clean.",
          items: { type: "string" },
        },
      },
      required: ["score", "issues"],
      additionalProperties: false,
    },
    centering: {
      type: "object",
      description:
        "Measured border ratios on the front, as percentages of the total border on each axis.",
      properties: {
        leftPct: {
          type: "number",
          description:
            "Left border as a percentage of (left + right). 50 is perfectly centred; 60 means the left border is half again the right.",
        },
        topPct: {
          type: "number",
          description:
            "Top border as a percentage of (top + bottom). 50 is perfectly centred.",
        },
      },
      required: ["leftPct", "topPct"],
      additionalProperties: false,
    },
    detectedDefects: {
      type: "array",
      description:
        "Every defect visible in the images, one entry each. Empty only for a genuinely flawless card.",
      items: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: Object.values(DefectCategory),
            description: "Which graded dimension this defect belongs to.",
          },
          severity: {
            type: "string",
            enum: Object.values(DefectSeverity),
            description:
              "minor: visible only on close inspection. moderate: obvious but localised. severe: caps the overall grade.",
          },
          location: {
            type: "string",
            description:
              "Where on the card, in plain words: 'upper right corner', 'lower third of the back'.",
          },
          description: {
            type: "string",
            description: "What the defect is, in one short phrase.",
          },
        },
        required: ["category", "severity", "location", "description"],
        additionalProperties: false,
      },
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
    "imageQuality",
    "centering",
    "detectedDefects",
  ],
  additionalProperties: false,
} as const;

/**
 * The grading instructions.
 *
 * Follows the ordered workflow the client specified on 2026-07-29. The order is
 * deliberate and load-bearing: assessing the PHOTOGRAPHS before the CARD is what
 * stops "the image is poor" from being scored as "the card is worn", which was
 * the main inconsistency in prototype V1.
 *
 * ⚠️ THIS TEXT IS PART OF THE GRADING CACHE KEY. Editing it without bumping
 * GRADING_MODEL_VERSION means new instructions get served old cached grades and
 * the "same images → same grade" guarantee breaks silently.
 */
export const SYSTEM_PROMPT = `You are a professional trading card grader assessing physical condition from photographs. Work through the following steps in order.

STEP 1 — ASSESS ALL PHOTOGRAPHS FIRST, INCLUDING CLOSE-UP AND MACRO SHOTS.
Judge focus, lighting, glare, cropping, and coverage across ALL provided images. Record this as imageQuality.
Note that images often include main front/back overview shots along with high-magnification close-up/macro images focusing on specific corners, edges, or surface details (e.g. PixelScope hardware scans). Macro crops and tight detail framing are DELIBERATE high-resolution inspection photos, NOT cropping errors or poor image quality. Inspect EVERY image thoroughly. If a macro shot reveals defects (such as whitening, scratches, nicks, or creasing), those defects MUST be evaluated and counted in your grading sub-scores. Do NOT penalize intentional macro crops or direct lighting reflections as image quality defects.

STEP 2 — ORIENT.
Account for perspective: a card photographed at an angle has borders that appear
uneven and corners that appear soft. Correct for that mentally before measuring.
Never score a perspective artefact as a defect.

STEP 3 — MEASURE CENTERING.
Compare the border widths on the front. Report leftPct as the left border as a
percentage of (left + right), and topPct likewise for (top + bottom). 50/50 is
perfect. Derive scoreCentering from those measurements, not from an impression:
50/50-55/45 is 10, 60/40 is about 8, 65/35 is about 6, 70/30 or worse is 5 or below.

STEP 4-6 — GRADE CORNERS, EDGES, AND SURFACE INDEPENDENTLY, each 0-10.
- Corners: sharpness, fraying, rounding, dings, bends
- Edges: chipping, whitening, nicks, roughness
- Surface: scratches, print lines, whitening, gloss, indentations, stains, texture
Score each on its own evidence across all images (both full views and macro shots). Do not let a weak category drag a clean one down, but do NOT ignore defects visible in macro images.

Use these anchors so the same condition scores the same every time. Pick the
lowest band the card fully satisfies — if it sits between two, take the lower.

CORNERS
  10  All four razor sharp at full zoom. No softening, no white pinpoint.
  9   One corner very slightly soft or a single pinpoint of white. Naked eye: perfect.
  8   Two or three corners slightly soft, or one with light visible whitening.
  7   Light fraying or blunting visible without zoom on one or more corners.
  5-6 Obvious rounding, whitening, or a bend at one or more corners.
  1-4 Heavy rounding, creasing through a corner, or material loss.

EDGES
  10  Clean and sharp all round. No chipping or white specks at full zoom.
  9   One or two pinpoint white specks. Invisible at arm's length.
  8   Light intermittent whitening along one edge, or a single small nick.
  7   Whitening visible without zoom along one or more edges.
  5-6 Chipping, roughness, or whitening along most of an edge.
  1-4 Heavy chipping, tears, or material loss.

SURFACE
  10  Flawless under direct light. No scratch, print line, dent, or gloss break.
  9   One faint scratch or print line visible only at an angle. No dents.
  8   Two or three faint marks, minor gloss variation, or very light print lines.
  7   A scratch visible at a glance, light scuffing, or a small indentation.
  5-6 Multiple scratches, a crease, a dent, staining, or notable gloss loss.
  1-4 Heavy creasing, water damage, writing, tearing, or peeling.

Be fair and objective: cards in clean, good condition with sharp corners, clean surfaces, and straight edges should be awarded 9s (MINT) and 10s (GEM-MINT). However, if close-up images reveal damage, apply appropriate sub-score deductions. Do not penalize cards for camera lighting, minor reflections, or photo resolution artifacts.

STEP 7 — LIST EVERY DEFECT, AND EXPLAIN IT.
Each one gets a category, a severity, a location, and a description in
detectedDefects. A defect you mention in reasoning must appear in this list, and
every sub-score below 10 must be explained by at least one defect in it.

description must be specific enough that the owner can find the defect on the
card while holding it, and understand what it cost them. Include:
  (a) WHAT it is — "a 2 mm white chip", not "some wear";
  (b) HOW VISIBLE it is — at a glance, only at an angle, only under zoom;
  (c) WHAT IT COST — which sub-score it pulled down and roughly by how much.

Bad:  "Minor edge wear."
Good: "A 2 mm patch of white chipping on the left edge, about a third of the way
       down, visible without magnification. This is the main reason edges scored
       8 rather than 9.5."

location is the position on the card in plain words — "upper right corner",
"left edge, lower third", "centre of the holo". Never leave it vague.

Do not invent defects to look thorough. If a category is genuinely clean, score
it 10 and list nothing for it.

STEP 8 — COMBINE INTO THE OVERALL GRADE.
The overall grade is NOT the mean of the sub-scores. It is capped by the worst
material defect: a card with a crease is not a 9 because three categories look
fine. As a rule the overall grade cannot exceed the lowest sub-score by more
than 0.5, and any severe defect caps it at 6 or below.

STEP 9 — SET CONFIDENCE HONESTLY.
Confidence reflects how much the IMAGES support a firm, conclusive condition judgement.
- For PixelScope Macro Scans: High-magnification detail photos allow precise inspection. Confidence can score HIGH (90-100%) when card details are clearly visible.
- For Standard Phone Uploads: The AI MUST differentiate and NEVER assume PixelScope was used. Camera lighting, glare, reflections, and non-flat angles reduce certainty. Standard phone photos MUST score confidence conservatively in the moderate/cautious range (60-85%) and must never exceed 85%.

STEP 10 — EXPLAIN.
reasoning must say why the overall grade landed where it did, naming the defects
that drove it and the sub-score that capped it. Write it for the card's owner,
not for another grader: plain language, no jargon without explanation, and
enough detail that someone disputing the grade knows exactly what to re-examine.

STEP 11 — CHECK YOURSELF BEFORE ANSWERING.
Re-read your own output and confirm all of the following. Fix anything that
fails; do not explain the inconsistency, correct it.
  - Every sub-score below 10 has at least one defect listed for it.
  - Every listed defect names a location and what it cost.
  - The overall grade is no more than 0.5 above the lowest sub-score.
  - Any severe defect has capped the overall grade at 6 or below.
  - scoreCentering matches the measured ratios, not an impression.
  - For PixelScope macro scans: confidence is >= 90% when clear detail photos are inspectable.
  - For standard phone uploads: confidence is <= 85% and reflects real-world image limitations (glare, angle, lighting).

Report only what is visible. Never infer condition from the card's identity,
rarity, or market value. Be internally consistent: the sub-scores, the defect
list, the overall grade, and the reasoning must all tell the same story.`;

export const buildUserPrompt = (input: GradingInput): string => {
  const isPixelScope = input.source === "pixelscope";
  const noteOnImages = isPixelScope
    ? "Note on images: This upload is a PixelScope hardware macro inspection scan (full card overview + high-magnification macro detail photos). High confidence (90-100%) is appropriate when card details are clear."
    : "Note on images: This upload is a STANDARD REGULAR PHONE PHOTO upload (NOT PixelScope). Do NOT assume PixelScope macro hardware was used. Regular phone photos carry limitations like glare, reflections, and lighting. Evaluate confidence conservatively (60-85% max) reflecting real-world photo uncertainty.";

  return [
    input.cardName ? `Card: ${input.cardName}` : null,
    input.cardSet ? `Set: ${input.cardSet}` : null,
    `Total Images Provided: ${input.imageUrls.length}`,
    `Upload Source: ${isPixelScope ? "PixelScope Macro Hardware" : "Standard Regular Phone Photo"}`,
    noteOnImages,
    "",
    "Grade this card from the images above.",
  ]
    .filter((line) => line !== null)
    .join("\n");
};

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, n));

/**
 * Normalises a provider's parsed JSON into GradingOutput.
 *
 * Clamps rather than trusts: a JSON schema constrains types, not ranges, so a
 * score of 11 or a confidence of 120 would otherwise reach Mongoose and fail
 * with an opaque validation error far from the cause.
 */
/** Coerces the model's defect array into shape, dropping anything malformed
 *  rather than letting a bad enum value reach Mongoose as a cast error. */
const normaliseDefects = (value: unknown): DetectedDefect[] => {
  if (!Array.isArray(value)) return [];

  const categories = Object.values(DefectCategory) as string[];
  const severities = Object.values(DefectSeverity) as string[];

  return value.flatMap((item): DetectedDefect[] => {
    if (typeof item !== "object" || item === null) return [];
    const record = item as Record<string, unknown>;

    const category = String(record.category ?? "");
    const severity = String(record.severity ?? "");
    if (!categories.includes(category) || !severities.includes(severity)) {
      return [];
    }

    return [
      {
        category: category as DefectCategory,
        severity: severity as DefectSeverity,
        location: String(record.location ?? "").slice(0, 120),
        description: String(record.description ?? "").slice(0, 240),
      },
    ];
  });
};

const normaliseImageQuality = (value: unknown): ImageQuality => {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  return {
    score: clamp(Number(record.score ?? 0), 0, 100),
    issues: Array.isArray(record.issues)
      ? record.issues.map((issue) => String(issue).slice(0, 160)).slice(0, 12)
      : [],
  };
};

/** Defaults to 50/50 — a missing measurement must read as "centred, unknown",
 *  never as an extreme that would silently justify a low centering score. */
const normaliseCentering = (value: unknown): CenteringMeasurement => {
  const record =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};

  const leftPct = Number(record.leftPct);
  const topPct = Number(record.topPct);

  return {
    leftPct: clamp(Number.isFinite(leftPct) ? leftPct : 50, 0, 100),
    topPct: clamp(Number.isFinite(topPct) ? topPct : 50, 0, 100),
  };
};

export const getGradeLabel = (grade: number): GradeLabel => {
  if (grade >= 9.8) return GradeLabel["GEM-MT"];
  if (grade >= 9.0) return GradeLabel.MINT;
  if (grade >= 8.0) return GradeLabel["NM-MT"];
  if (grade >= 7.0) return GradeLabel.NM;
  if (grade >= 5.0) return GradeLabel.EX;
  if (grade >= 3.0) return GradeLabel.VG;
  if (grade >= 1.5) return GradeLabel.GOOD;
  if (grade >= 1.0) return GradeLabel.FR;
  return GradeLabel.PR;
};

export const normalise = (
  parsed: Record<string, unknown>,
  modelVersion: string,
  raw: unknown,
  source?: string,
): GradingOutput => {
  const scoreSurface = clamp(Number(parsed.scoreSurface), 0, 10);
  const scoreCorners = clamp(Number(parsed.scoreCorners), 0, 10);
  const scoreEdges = clamp(Number(parsed.scoreEdges), 0, 10);
  const scoreCentering = clamp(Number(parsed.scoreCentering), 0, 10);

  const minSubscore = Math.min(scoreSurface, scoreCorners, scoreEdges, scoreCentering);
  const parsedGrade = clamp(Number(parsed.grade), 0, 10);

  // Overall grade is capped by lowest subscore (Step 8 of grading rules).
  let finalGrade = parsedGrade;
  if (minSubscore > 0 && finalGrade > minSubscore + 2.0) {
    finalGrade = Math.round((minSubscore + 2.0) * 2) / 2;
  }
  finalGrade = clamp(finalGrade, 0, 10);

  const finalGradeLabel = getGradeLabel(finalGrade);

  // Standard phone photo uploads are capped at 85% max confidence ceiling to reflect real-world photo limitations
  const maxConfidence = source === "pixelscope" ? 100 : 85;

  return {
    grade: finalGrade,
    gradeLabel: finalGradeLabel,
    scoreSurface,
    scoreCorners,
    scoreEdges,
    scoreCentering,
    confidence: clamp(Number(parsed.confidence), 0, maxConfidence),
    reasoning: String(parsed.reasoning ?? ""),
    imageQuality: normaliseImageQuality(parsed.imageQuality),
    centering: normaliseCentering(parsed.centering),
    detectedDefects: normaliseDefects(parsed.detectedDefects),
    modelVersion,
    raw,
  };
};

/**
 * The Pixel Verified rule, in one place, vendor-independent.
 *
 * Both conditions are server-derived: `source` comes from the stored analysis,
 * `confidence` from the model. Nothing here reads a request body, which is what
 * makes the badge un-forgeable.
 */
export const isPixelVerified = (source: string, confidence: number): boolean =>
  source === "pixelscope" && confidence >= PIXEL_VERIFIED_MIN_CONFIDENCE;
