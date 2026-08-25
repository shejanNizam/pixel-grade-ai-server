export const excludeField = [
  "searchTerm",
  "sort",
  "fields",
  "page",
  "limit",
  "isDeleted",
];

// ---------------------------------------------------------------------------
// Credits
//
// Usage is metered in credits, not scan counts. A scan is refused outright when
// the balance is short — the check and the debit both happen server-side, so a
// client can never talk its way into a free scan.
// ---------------------------------------------------------------------------

/** Credits burned by one grading scan. Mirrors CREDITS_PER_SCAN on the frontend. */
export const CREDITS_PER_SCAN = 5;

/**
 * Daily allowance for Free, re-granted by cron rather than accrued. No rollover.
 *
 * The client states Free in *scans* (5 per day, 2026-08-10), so this is
 * 5 × CREDITS_PER_SCAN. Quote plan sizes in scans and store them in credits —
 * writing the scan count straight into this field silently cuts the allowance
 * by a factor of CREDITS_PER_SCAN.
 */
export const FREE_DAILY_CREDITS = 25;

/**
 * How long a scan may sit unconfirmed before the sweeper refunds it.
 *
 * The debit happens up-front (it is what pays for the vendor's identification
 * call), but the client's rule is that CREDITS_PER_SCAN buys a *finished
 * report*. A
 * scan the user walked away from at the confirmation screen produced nothing,
 * so the credits go back. 30 minutes is well past any realistic "read the
 * candidates and pick one" pause, and short enough that a Free user gets their
 * daily allowance back the same day.
 */
export const ABANDONED_SCAN_TIMEOUT_MINUTES = 30;

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/** Minimum confidence for Pixel Verified. The other half of the rule is that the
 *  upload came through PixelScope — both must hold, and only the server decides. */
export const PIXEL_VERIFIED_MIN_CONFIDENCE = 90;

/** Upper bound on images per side in a PixelScope upload (front + back = 20 max). */
export const PIXELSCOPE_MAX_IMAGES_PER_SIDE = 10;

/** A standard scan is one photo per side — front + back, matching the Quick
 *  Import screen, which requires both before it enables the scan button.
 *  Two fronts is NOT a valid standard scan; the limit is per side, not total.
 *  (Identification still sends only the first image; the second one improves
 *  grading, which otherwise caps its confidence on an unseen back.) */
export const STANDARD_MAX_IMAGES_PER_SIDE = 1;

// ---------------------------------------------------------------------------
// Price alerts
// ---------------------------------------------------------------------------

/** A card must move at least this much (percent, either direction) over 24h
 *  before holders are notified. With the daily refresh cadence this also caps
 *  alerts at one per card per day — no separate throttle needed. */
export const PRICE_ALERT_THRESHOLD_PCT = 10;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;

// ---------------------------------------------------------------------------
// Slab label geometry
//
// Client-confirmed, but the printer's final spec sheet may still move these, so
// every label stores its own copy of the numbers and rendering reads from the
// document — never from these constants directly. They are defaults only.
// ---------------------------------------------------------------------------

export const SLAB_DEFAULTS = {
  /**
   * Overall trim, in millimetres.
   *
   * 2026-08-06: the client sent the holder manufacturer's own spec sheet —
   * 5.35 in × 3.15 in × 0.27 in — which is 136 × 80 × 7 mm. Height moved
   * 135 → 136. Previous revisions: 94 × 138 (v1), 80 × 135 (2026-07-29).
   *
   * The 7 mm thickness has no effect on a flat 2D export; it is recorded here
   * so nobody has to re-derive it if a 3D mockup or packaging spec is ever
   * needed.
   */
  widthMm: 80,
  heightMm: 136,
  /**
   * The card window — the *visible* aperture, not the card.
   *
   * 2026-08-06: 65 → 64 mm wide, per the same spec sheet (2.54 in × 3.54 in).
   * Height is unchanged at 90 mm. Note this is narrower than a standard
   * 63.5 × 88 mm trading card by design: the holder overlaps the card edges,
   * which is what stops it sliding.
   */
  openingWidthMm: 64,
  openingHeightMm: 90,
  /** The grading label band, which sits ABOVE the card window. Its height is
   *  the tightest constraint on the whole design: 20 mm is 236 px at 300 DPI
   *  and has to hold the wordmark, card name, grade, Pixel ID, and QR. */
  labelWidthMm: 70,
  labelHeightMm: 20,
  /** Printed area extending past the trim line, all four sides. */
  bleedMm: 3,
  /** Keep-clear margin inside the trim for text, QR, and grade. */
  safeMm: 3,
} as const;

export const SLAB_EXPORT_DPI = 300;

/**
 * The label band's frosted-glass treatment.
 *
 * Client feedback 2026-07-30: the band read as "a separate or random
 * background" — a flat near-opaque plate sitting on top of the artwork rather
 * than part of it. It is now the artwork itself, blurred and darkened in place,
 * so the scene shows through the panel the way it does through real holder
 * plastic.
 *
 * ⚠️ These two numbers are a LEGIBILITY CONTRACT, not styling. The artwork
 * behind the band is AI-generated and its brightness is unpredictable, and
 * unreadable text on a printed slab cannot be recovered — the slab is the
 * product. Together they set the worst case: the brightest possible backdrop
 * (white) is multiplied to `BAND_FROST_BRIGHTNESS`, then composited under a
 * scrim of `BAND_SCRIM_OPACITY` near-black, which lands white body text at
 * about 18:1 contrast — comfortably past the 4.5:1 floor with room for print
 * dot gain. Raising either value to show more of the scene eats that margin,
 * so re-check the contrast maths before touching them; `slabComposite.test.ts`
 * pins the arithmetic.
 *
 * 2026-08-25: darkened from 0.55 / 0.45 to match the client's reference band,
 * which reads as near-black. The direction was "keep the glass, take it much
 * closer to black", so the treatment is unchanged and only the two numbers
 * moved. Note which way this cuts: the contrast floor gets STRICTLY better
 * (~8.4:1 → ~18:1). What it spends is the other half of the 2026-07-30 note —
 * how much scene survives — and that is now the constraint to watch. A
 * mid-grey backdrop contributes ~9 of the band's ~18 levels, so the artwork is
 * still half of what is drawn there; push either number further and the band
 * becomes the flat plate the client rejected.
 */
export const BAND_FROST_BLUR_SIGMA = 18;
export const BAND_FROST_BRIGHTNESS = 0.34;
export const BAND_SCRIM_OPACITY = 0.8;

/** Full-bleed export canvas in pixels, at SLAB_EXPORT_DPI — (80+6) × (136+6) mm.
 *  Derived from SLAB_DEFAULTS; kept as a literal for the frontend preview and
 *  for tests that assert the export size without instantiating a label.
 *  Was 1016 × 1665 while the trim was 135 mm tall (until 2026-08-06). */
export const SLAB_CANVAS_PX = { width: 1016, height: 1677 } as const;

/** Background art styles. Each maps to its own image-generation prompt. */
export const SLAB_STYLES = ["cosmic", "inferno", "aurora", "vintage"] as const;
export type SlabStyle = (typeof SLAB_STYLES)[number];

/**
 * What goes in the slab's card window.
 *
 * - `scan`      the user's own front photograph. The card that was actually
 *               graded, wear and all. The honest choice for a grading product.
 * - `catalogue` the publisher's official card image from the identification
 *               service. Clean and straight, but a better-looking copy than
 *               the one the grade describes.
 * - `generated` an AI rendering of the card, from its metadata.
 *
 * ⚠️ `generated` was directed by the client on 2026-07-30 and carries risks
 * they own, not us — see docs/OPEN-QUESTIONS.md. It also degrades: image
 * models cannot render a card's text, HP, or set symbol legibly, and the
 * provider frequently refuses the prompt outright. Every failure falls back
 * down this list, so a slab always renders something real.
 */
export const SLAB_CARD_RENDER_MODES = [
  "scan",
  "catalogue",
  "generated",
] as const;
export type SlabCardRenderMode = (typeof SLAB_CARD_RENDER_MODES)[number];

// ---------------------------------------------------------------------------
// Redis key prefixes
//
// Grading results are cached by image-set hash — that cache is what makes the
// "same image always produces the same grade" guarantee hold.
// ---------------------------------------------------------------------------

export const REDIS_KEYS = {
  otp: "otp:",
  gradingResult: "grading:",
  identification: "ident:",
  cardPrice: "price:",
} as const;
