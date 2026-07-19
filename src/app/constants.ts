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
export const CREDITS_PER_SCAN = 10;

/** Daily allowance for Free, re-granted by cron rather than accrued. No rollover. */
export const FREE_DAILY_CREDITS = 20;

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
  /** Overall trim, in millimetres. */
  widthMm: 94,
  heightMm: 138,
  /** The card window. Fixed — it never shifts relative to the trim. */
  openingWidthMm: 65,
  openingHeightMm: 90,
  /** Printed area extending past the trim line, all four sides. */
  bleedMm: 3,
  /** Keep-clear margin inside the trim for text, QR, and grade. */
  safeMm: 3,
} as const;

export const SLAB_EXPORT_DPI = 300;

/** Full-bleed export canvas in pixels, at SLAB_EXPORT_DPI. */
export const SLAB_CANVAS_PX = { width: 1181, height: 1701 } as const;

/** Background art styles. Each maps to its own image-generation prompt. */
export const SLAB_STYLES = ["cosmic", "inferno", "aurora", "vintage"] as const;
export type SlabStyle = (typeof SLAB_STYLES)[number];

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
