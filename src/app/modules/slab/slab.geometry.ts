import { SLAB_EXPORT_DPI } from "../../constants";
import { ISlabLabel } from "./slab.interface";

/**
 * Slab geometry maths.
 *
 * Every dimension is read from the label document, never from the constants —
 * the printer's final spec sheet may move these numbers, and a label already
 * exported (or already paid for) must keep rendering at the size it was sold
 * at. The constants are only defaults applied at creation time.
 */

/** Millimetres to pixels at the export DPI. 25.4 mm = 1 inch. */
export const mmToPx = (mm: number, dpi: number = SLAB_EXPORT_DPI): number =>
  Math.round((mm / 25.4) * dpi);

export interface SlabLayout {
  /** Full-bleed canvas: trim plus bleed on all four sides. */
  canvasWidth: number;
  canvasHeight: number;
  /** Where the trim line falls inside the canvas. */
  trimX: number;
  trimY: number;
  trimWidth: number;
  trimHeight: number;
  /** The card window — horizontally centred, positioned by optical balance. */
  openingX: number;
  openingY: number;
  openingWidth: number;
  openingHeight: number;
  /** Keep-clear rectangle for text and QR. */
  safeX: number;
  safeY: number;
  safeWidth: number;
  safeHeight: number;
  /** The grading label band, ABOVE the card window. */
  labelX: number;
  labelY: number;
  labelWidth: number;
  labelHeight: number;
}

/**
 * Resolves a label's stored millimetre dimensions into pixel coordinates.
 *
 * Layout, top to bottom: safe margin → label band → gap → card window → the
 * remaining space at the bottom. The label sits above the window (client
 * feedback 2026-07-29, prototype V1); it used to sit below, and the difference
 * is structural rather than cosmetic because the window position is derived
 * from where the band ends.
 *
 * The leftover vertical space is split one-third above the window and
 * two-thirds below. An even split reads as though the card has slipped down
 * the holder — the eye expects more room beneath a framed object than above it.
 */
export const computeLayout = (label: ISlabLabel): SlabLayout => {
  const canvasWidth = mmToPx(label.widthMm + label.bleedMm * 2);
  const canvasHeight = mmToPx(label.heightMm + label.bleedMm * 2);

  const trimX = mmToPx(label.bleedMm);
  const trimY = mmToPx(label.bleedMm);
  const trimWidth = mmToPx(label.widthMm);
  const trimHeight = mmToPx(label.heightMm);

  const safePx = mmToPx(label.safeMm);
  const safeX = trimX + safePx;
  const safeY = trimY + safePx;
  const safeWidth = trimWidth - safePx * 2;
  const safeHeight = trimHeight - safePx * 2;

  const labelWidth = mmToPx(label.labelWMm);
  const labelHeight = mmToPx(label.labelHMm);
  const labelX = trimX + Math.round((trimWidth - labelWidth) / 2);
  const labelY = safeY;

  const openingWidth = mmToPx(label.openingWMm);
  const openingHeight = mmToPx(label.openingHMm);
  const openingX = trimX + Math.round((trimWidth - openingWidth) / 2);

  // Guarded against a bad spec: if someone stores dimensions whose parts do not
  // fit the trim, the window butts straight up against the band rather than
  // being pushed off the bottom of the canvas.
  const verticalSlack = Math.max(
    0,
    safeHeight - labelHeight - openingHeight,
  );
  const openingY = labelY + labelHeight + Math.round(verticalSlack / 3);

  return {
    canvasWidth,
    canvasHeight,
    trimX,
    trimY,
    trimWidth,
    trimHeight,
    openingX,
    openingY,
    openingWidth,
    openingHeight,
    safeX,
    safeY,
    safeWidth,
    safeHeight,
    labelX,
    labelY,
    labelWidth,
    labelHeight,
  };
};
