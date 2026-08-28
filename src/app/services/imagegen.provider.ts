import httpStatus from "http-status";
import OpenAI from "openai";
import { uploadBufferToCloudinary } from "../config/cloudinary.config";
import { configs } from "../config/index";
import { SlabStyle } from "../constants";
import AppError from "../errorHelpers/AppError";
import { logger } from "../utils/logger";

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

/** One prompt per confirmed style. Kept here so a style change is one edit.
 *
 *  ⚠️ LEGACY. Fixed themes were replaced on 2026-07-30 by four card-derived
 *  variants (see EXT_ART_TREATMENTS). Retained only so labels created before
 *  that date still re-render with the artwork they were sold with. */
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

/**
 * The four EXT. ART treatments.
 *
 * Every option is derived from the SAME card, so something has to make them
 * meaningfully different or the user is picking between four near-identical
 * images — the choice the client asked for would be no choice at all. These
 * vary the framing and light rather than the subject, so all four still read as
 * that card's world.
 */
export const EXT_ART_TREATMENTS = [
  "Wide establishing view of the environment, deep depth, distant horizon, balanced daylight.",
  "Close, intimate detail of the same environment, shallow depth, soft focus falloff, rich texture.",
  "Dramatic low light, strong directional shafts, deep shadow, high contrast.",
  "Soft diffuse ambience, gentle haze, muted pastel wash, low contrast.",
] as const;

/** How many options a generation batch produces. */
export const EXT_ART_COUNT = EXT_ART_TREATMENTS.length;

/** Prefixed onto every style prompt. The model occasionally invents lettering
 *  or figures; stating the constraints once, up front, is the strongest lever
 *  we have against artwork that would clash with the composited label. */
const PROMPT_PREAMBLE =
  "Full-bleed background artwork for a collectible card display case. " +
  "Purely a setting: absolutely no text, no letters, no numbers, no logos, " +
  "no people, no creatures, no characters. Edge-to-edge, portrait. ";

/**
 * Where the slab's own furniture lands on this image.
 *
 * The generated art is not seen whole: a 64×90 mm card covers the middle of an
 * 80×136 mm slab and the label band covers the top ~20 mm. So the model was
 * being asked for a composition and then having most of it hidden — the detail
 * it worked hardest on ended up under the card, and whatever busy area happened
 * to fall at the top fought the band for attention.
 *
 * Client feedback 2026-07-30: the art should read as a continuation of the card
 * rather than a separate backdrop. Half of that is palette (see
 * buildArtDirection) and half is composition — the margins around the card are
 * the only part anyone actually sees, so that is where the scene has to work.
 *
 * Stated in plain spatial language rather than millimetres: image models handle
 * "upper fifth" far more reliably than any measurement.
 */
const COMPOSITION_DIRECTION =
  " Composition: keep the upper fifth of the image calm and uncluttered — " +
  "open sky, haze, or soft shade — with no focal detail there. Keep the " +
  "centre simple and unbusy. Carry the richest detail and depth down the " +
  "left and right edges and across the lower third, so the scene reads " +
  "around a rectangular object resting in the middle. Continuous scene, even " +
  "lighting, no vignette, no frame, no border.";

/**
 * Seam direction — how the artwork meets the card.
 *
 * Client, 2026-08-06: the extension should "blend naturally with the original
 * card background ... rather than looking like separate AI-generated art".
 *
 * What is actually adjustable here is the *transition*, not the content. The
 * generator never sees the card (see buildArtDirection for why), so it cannot
 * literally continue the card's illustration. What it can do is arrive at the
 * card's edge quietly: matched lighting direction, no competing focal point
 * against the border, painted rather than photoreal so the two read as one
 * medium, and no hard tonal step where the card sits.
 *
 * ⚠️ Honest limitation, already flagged to the client (OPEN-QUESTIONS §B): a
 * standard BORDERED card has a hard printed frame, so nothing outside it can
 * ever be visually continuous. This reads strongly on full-art and alt-art
 * cards — the client's own Electivire sample is one — and weakly on ordinary
 * bordered ones. No prompt fixes that; it is a property of the card.
 */
const SEAM_DIRECTION =
  " Painted illustration style, soft and atmospheric, in the manner of " +
  "traditional collectible-card artwork — not a photograph and not a 3D " +
  "render. Single consistent light source. The area immediately around the " +
  "centre must be quiet and even in tone, so a rectangular object placed " +
  "there meets the scene without a visible step in brightness or colour.";

/** What the slab pipeline knows about the card being framed. */
export interface CardArtContext {
  cardName?: string;
  setExpansion?: string;
  /**
   * Publisher energy/colour types, e.g. ["Lightning"].
   *
   * The most reliable palette lever available. Image models handle "a lightning
   * type's habitat" far more consistently than a creature name they may never
   * have seen, and it steers colour without naming anything copyrighted.
   */
  types?: string[];
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

  // The energy type is the reliable half of this. A model that has never seen
  // "Electivire" still knows exactly what a lightning-charged landscape looks
  // like, so the type is stated as the dominant palette instruction and the
  // name is left as a secondary hint.
  const types = (context?.types ?? []).filter(Boolean);
  const palette = types.length
    ? ` Dominant palette and weather: that of a ${types.join(" and ")} ` +
      `type — its characteristic colours, light, and elemental atmosphere ` +
      `should govern the whole image.`
    : "";

  return (
    `. Render the natural ENVIRONMENT a creature named "${subject}" would ` +
    `inhabit — its habitat, palette, and atmosphere — as an empty landscape. ` +
    `The environment only: the creature itself must NOT appear, and neither ` +
    `must any character, text, or trading-card imagery.${palette}`
  );
};

const MODEL = "gpt-image-1";

/** Largest portrait size gpt-image-1 offers; see the SIZE note above. */
const OUTPUT_SIZE = "1024x1536" as const;

/** "medium" is visually ample for a backdrop that sits behind a card and a
 *  label; "high" roughly quadruples the cost for detail nobody will see. */
const QUALITY = "medium" as const;

/** Ceiling for one image request, including the SDK's own retries. */
const IMAGE_REQUEST_TIMEOUT_MS = 180_000;

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
    // Explicit, because the defaults are wrong for this workload. A medium
    // gpt-image-1 render routinely takes 30-90s, and four requested at once
    // queue behind each other — long enough that an unbounded wait turns a
    // slow generation into a dead socket rather than an error we can report.
    timeout: IMAGE_REQUEST_TIMEOUT_MS,
    maxRetries: 2,
  });
  return client;
};

/**
 * Runs one prompt and returns a permanent URL.
 *
 * gpt-image-1 returns base64 rather than a hosted URL, and OpenAI's hosted
 * image URLs expire anyway — so the image is pushed straight to Cloudinary,
 * which is already the platform's permanent image store. The slab pipeline
 * then fetches it back by URL exactly as it would from any other vendor.
 */
const renderPrompt = async (
  prompt: string,
  publicIdPrefix: string,
  size: "1024x1536" = OUTPUT_SIZE,
): Promise<string> => {
  const response = await getClient().images.generate({
    model: MODEL,
    prompt,
    size,
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
    `${publicIdPrefix}-${Date.now()}`,
  );
  if (!upload?.secure_url) {
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      "Generated background could not be stored.",
    );
  }

  return upload.secure_url;
};

/**
 * LEGACY single-background generation from a fixed theme.
 *
 * Superseded by `generateExtArtSet`. Kept so a label created before
 * 2026-07-30 can still be re-rendered with the artwork it was sold with.
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

  return renderPrompt(
    PROMPT_PREAMBLE +
      prompt +
      buildArtDirection(cardContext) +
      SEAM_DIRECTION +
      COMPOSITION_DIRECTION,
    `slab-bg-${style}`,
  );
};

/**
 * Generates the four EXT. ART options for one card.
 *
 * ⚠️ COST: this is FOUR billed images per call, roughly $0.08–$1.00 depending
 * on quality — and "Regenerate artwork" spends it again. It is deliberately
 * NOT called at scan time (see slab.service.ts): a scan that never becomes a
 * slab order would otherwise burn four images for nothing.
 *
 * The four run concurrently — sequentially this is four round-trips and the
 * user is staring at a spinner for all of them.
 *
 * A partial failure is tolerated: three good options is a usable choice, and
 * failing the whole batch because one image tripped a content filter would
 * strand the user with nothing. Only an empty result is an error.
 */
const generateExtArtSet = async (
  _cardContext?: CardArtContext,
): Promise<string[]> => {
  // Extended artwork generation is disabled per client instruction ("lets remove that feature for now").
  // Return neutral dark slab background to avoid DALL-E API calls.
  const DEFAULT_NEUTRAL_BG =
    "data:image/svg+xml;base64," +
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#141416"/><stop offset="50%" stop-color="#0d0d0f"/><stop offset="100%" stop-color="#08080a"/></linearGradient></defs><rect width="1024" height="1536" fill="url(#g)"/></svg>`,
    ).toString("base64");

  return [DEFAULT_NEUTRAL_BG];
};

/** What the card generator knows about the card it is asked to draw. */
export interface GeneratedCardContext {
  cardName: string;
  setExpansion?: string;
  cardNumber?: string;
  rarity?: string;
  year?: string;
}

/**
 * Renders the card itself, rather than using a photograph of it.
 *
 * DIRECTED BY THE CLIENT, 2026-07-30, over a documented objection. Two things
 * about it are worth knowing before reading the prompt below:
 *
 * 1. IT OFTEN WILL NOT RUN. Naming a specific trading card trips OpenAI's
 *    content filters, and the request comes back refused. That is why this
 *    returns `null` on failure instead of throwing — the caller falls back to
 *    a real image and the slab still renders.
 *
 * 2. WHAT IT PRODUCES IS NOT THE CARD. Image models cannot render legible
 *    small text, so the HP, attack names, damage numbers, set symbol, and
 *    copyright line come out as garbled shapes. The result reads as a
 *    convincing-at-a-glance, wrong-on-inspection imitation.
 *
 * Because of (2) the prompt deliberately asks for NO text anywhere rather than
 * letting the model attempt lettering and fail: an illustration with clean
 * empty panels looks intentional, whereas one covered in scrambled glyphs
 * looks broken. The composited PixelGrade label carries the real card details.
 */
const generateCardImage = async (
  context: GeneratedCardContext,
): Promise<string | null> => {
  const descriptors = [
    context.year,
    context.setExpansion,
    context.rarity ? `${context.rarity} rarity` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const prompt =
    `Original illustrated collectible card artwork in a portrait frame, ` +
    `depicting a creature named "${context.cardName}"` +
    (descriptors ? ` in the visual style of ${descriptors}` : "") +
    `. Painted illustration inside a decorative border, holographic sheen, ` +
    `clean studio lighting, straight-on view, sharp focus, no glare. ` +
    `ABSOLUTELY NO TEXT, no letters, no numbers, no logos, no symbols, and no ` +
    `watermarks anywhere in the image — leave those areas as plain empty panels.`;

  try {
    return await renderPrompt(prompt, `slab-card-${Date.now()}`);
  } catch (error) {
    // Never fatal. A refused or failed generation must not cost the user the
    // slab they already paid credits to grade.
    logger.error("Card image generation failed — falling back to a real image", {
      cardName: context.cardName,
      error,
    });
    return null;
  }
};

export const ImageGenProvider = {
  generateBackground,
  generateExtArtSet,
  generateCardImage,
  EXT_ART_COUNT,
  isConfigured,
  STYLE_PROMPTS,
};
