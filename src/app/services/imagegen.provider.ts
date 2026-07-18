import httpStatus from "http-status";
import { configs } from "../config/index";
import { SlabStyle } from "../constants";
import AppError from "../errorHelpers/AppError";

/**
 * Slab background generation.
 *
 * Only the background artwork is generated. The card window and the label text
 * are composited server-side afterwards (see slab.service.ts) so a bad
 * generation can never move the card opening or corrupt the label.
 *
 * Vendor unconfirmed — docs/OPEN-QUESTIONS.md #2.
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

const isConfigured = (): boolean =>
  Boolean(configs.IMAGEGEN.api_key && configs.IMAGEGEN.base_url);

/** Returns a URL to the generated background at the requested pixel size. */
const generateBackground = async (
  style: SlabStyle,
  widthPx: number,
  heightPx: number,
): Promise<string> => {
  if (!isConfigured()) {
    throw new AppError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Slab background generation is not configured — IMAGEGEN_API_KEY and IMAGEGEN_BASE_URL are missing. See docs/OPEN-QUESTIONS.md.",
    );
  }

  // TODO(client-credentials): implement against the confirmed image service.
  throw new AppError(
    httpStatus.NOT_IMPLEMENTED,
    `Background generation is not implemented yet (style=${style}, ${widthPx}x${heightPx}).`,
  );
};

export const ImageGenProvider = {
  generateBackground,
  isConfigured,
  STYLE_PROMPTS,
};
