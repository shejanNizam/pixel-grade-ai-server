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
  /** Space below the card window, where the label text goes. */
  labelY: number;
  labelHeight: number;
}

/**
 * Resolves a label's stored millimetre dimensions into pixel coordinates.
 *
 * The card window sits slightly above true vertical centre: the label text
 * occupies the space beneath it, and a mathematically centred window leaves a
 * cramped text band and a dead strip up top. Offsetting by a third of the
 * leftover vertical space is the standard slab proportion.
 */
export const computeLayout = (label: ISlabLabel): SlabLayout => {
  const canvasWidth = mmToPx(label.widthMm + label.bleedMm * 2);
  const canvasHeight = mmToPx(label.heightMm + label.bleedMm * 2);

  const trimX = mmToPx(label.bleedMm);
  const trimY = mmToPx(label.bleedMm);
  const trimWidth = mmToPx(label.widthMm);
  const trimHeight = mmToPx(label.heightMm);

  const openingWidth = mmToPx(label.openingWMm);
  const openingHeight = mmToPx(label.openingHMm);

  const openingX = trimX + Math.round((trimWidth - openingWidth) / 2);
  const verticalSlack = trimHeight - openingHeight;
  const openingY = trimY + Math.round(verticalSlack / 3);

  const safeX = trimX + mmToPx(label.safeMm);
  const safeY = trimY + mmToPx(label.safeMm);
  const safeWidth = trimWidth - mmToPx(label.safeMm) * 2;
  const safeHeight = trimHeight - mmToPx(label.safeMm) * 2;

  const labelY = openingY + openingHeight;
  const labelHeight = trimY + trimHeight - labelY - mmToPx(label.safeMm);

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
    labelY,
    labelHeight,
  };
};
