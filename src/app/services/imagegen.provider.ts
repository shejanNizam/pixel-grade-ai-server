import httpStatus from "http-status";
import OpenAI from "openai";
import { uploadBufferToCloudinary } from "../config/cloudinary.config";
import { configs } from "../config/index";
import { SlabStyle } from "../constants";
import AppError from "../errorHelpers/AppError";

/**
 * Slab background generation — OpenAI gpt-image-1.
 *
 * Vendor confirmed by the client 2026-07-19 (same account as grading, so
 * `OPENAI_API_KEY` covers this too; `IMAGEGEN_API_KEY` remains as an override
 * hook if backgrounds ever move to a separate account or vendor).
 *
 * Only the background artwork is generated. The card window and the label text
 * are composited server-side afterwards (see slab.service.ts) so a bad
 * generation can never move the card opening or corrupt the label.
 *
 * SIZE: gpt-image-1's largest portrait output is 1024×1536, while the export
 * canvas is 1181×1701. The composite step (`slab.composite.ts`) resizes the
 * background to the canvas with `fit: "cover"` — a ~15% upscale, invisible on
 * abstract art — so the requested pixel size here is advisory, not binding.
 *
 * COST: each call is a billed image (roughly $0.02–$0.25 depending on
 * quality). Regeneration hits this every time; the per-label regenerate flow
 * is where any spend cap belongs.
 */

/** One prompt per confirmed style. Kept here so a style change is one edit. */
export const STYLE_PROMPTS: Record<SlabStyle, string> = {
  cosmic:
    "Deep space nebula, violet and indigo, scattered starfield, soft volumetric glow, no text, no characters, no borders",
  inferno:
    "Molten ember texture, deep crimson and orange, drifting sparks, dark vignette, no text, no characters, no borders",
  aurora:
    "Northern lights over a dark sky, teal and emerald ribbons, subtle gradient, no text, no characters, no borders",
  vintage:
    "Aged parchment texture, warm sepia, subtle paper grain and foxing, muted gold accents, no text, no characters, no borders",
};

/** Prefixed onto every style prompt. The model occasionally invents lettering
 *  or figures; stating the constraints once, up front, is the strongest lever
 *  we have against artwork that would clash with the composited label. */
const PROMPT_PREAMBLE =
  "Abstract full-bleed background artwork for a collectible card display case. " +
  "Purely decorative: absolutely no text, no letters, no numbers, no logos, " +
  "no people, no creatures, no recognisable objects. Edge-to-edge, portrait. ";

/** What the slab pipeline knows about the card being framed. */
export interface CardArtContext {
  cardName?: string;
  setExpansion?: string;
}

/**
 * Turns the confirmed card into art direction for the backdrop.
 *
 * The client asked for backgrounds that "match the scanned card" (2026-07-29).
 * What that can safely mean is palette and mood — an evergreen forest cast
 * behind a Grass-type, embers behind a Fire-type — because the card artwork
 * itself is the publisher's copyrighted work and reproducing or extending it
 * onto a slab we sell would be a derivative of it. So the card name is passed
 * as a COLOUR AND ATMOSPHERE cue, and the no-creatures/no-text constraint from
 * PROMPT_PREAMBLE is restated here rather than relaxed, because naming a
 * Pokémon in a prompt is precisely what tempts the model to draw one.
 */
const buildArtDirection = (context?: CardArtContext): string => {
  const subject = [context?.cardName, context?.setExpansion]
    .filter(Boolean)
    .join(", ");
  if (!subject) return "";

  return (
    `. Tune the colour palette and atmosphere so it complements a trading card ` +
    `themed around "${subject}". Take ONLY colour and mood from that theme — ` +
    `still no creatures, characters, text, or card imagery of any kind.`
  );
};

const MODEL = "gpt-image-1";

/** Largest portrait size gpt-image-1 offers; see the SIZE note above. */
const OUTPUT_SIZE = "1024x1536" as const;

/** "medium" is visually ample for a backdrop that sits behind a card and a
 *  label; "high" roughly quadruples the cost for detail nobody will see. */
const QUALITY = "medium" as const;

let client: OpenAI | null = null;

/** IMAGEGEN_API_KEY overrides; otherwise the shared OpenAI account is used. */
const apiKey = (): string | undefined =>
  configs.IMAGEGEN.api_key || configs.GRADING.openai_api_key;

const isConfigured = (): boolean => Boolean(apiKey());

const getClient = (): OpenAI => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Slab background generation is not configured — OPENAI_API_KEY (or IMAGEGEN_API_KEY) is missing.",
    );
  }
  client ??= new OpenAI({
    apiKey: apiKey(),
    ...(configs.IMAGEGEN.base_url ? { baseURL: configs.IMAGEGEN.base_url } : {}),
  });
  return client;
};

/**
 * Generates one background and returns a permanent URL.
 *
 * gpt-image-1 returns base64 rather than a hosted URL, and OpenAI's hosted
 * image URLs expire anyway — so the image is pushed straight to Cloudinary,
 * which is already the platform's permanent image store. The slab pipeline
 * then fetches it back by URL exactly as it would from any other vendor.
 */
const generateBackground = async (
  style: SlabStyle,
  widthPx: number,
  heightPx: number,
  cardContext?: CardArtContext,
): Promise<string> => {
  const prompt = STYLE_PROMPTS[style];
  if (!prompt) {
    throw new AppError(httpStatus.BAD_REQUEST, `Unknown slab style: ${style}`);
  }

  // Advisory only — see the SIZE note above.
  void widthPx;
  void heightPx;

  const response = await getClient().images.generate({
    model: MODEL,
    prompt: PROMPT_PREAMBLE + prompt + buildArtDirection(cardContext),
    size: OUTPUT_SIZE,
    quality: QUALITY,
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Image generation returned no image data.",
    );
  }

  const upload = await uploadBufferToCloudinary(
    Buffer.from(b64, "base64"),
    `slab-bg-${style}`,
  );
  if (!upload?.secure_url) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Generated background could not be stored.",
    );
  }

  return upload.secure_url;
};

export const ImageGenProvider = {
  generateBackground,
  isConfigured,
  STYLE_PROMPTS,
};
