import { SLAB_DEFAULTS, SLAB_CANVAS_PX } from "../app/constants";
import { computeLayout, mmToPx } from "../app/modules/slab/slab.geometry";
import { ISlabLabel } from "../app/modules/slab/slab.interface";

/**
 * Slab geometry, against the holder manufacturer's spec sheet (client,
 * 2026-08-06: 80 × 136 × 7 mm, 64 × 90 mm window, 70 × 20 mm band).
 *
 * The label band sits above the card window, which is what determines how the
 * window's position is derived. These assertions pin the relationships that the
 * printed slab depends on — a regression here produces a label that looks fine
 * on screen and is wrong on paper, and nobody finds out until it is printed.
 */

/** A label document carrying the current defaults. */
const labelWithDefaults = (overrides: Partial<ISlabLabel> = {}) =>
  ({
    widthMm: SLAB_DEFAULTS.widthMm,
    heightMm: SLAB_DEFAULTS.heightMm,
    openingWMm: SLAB_DEFAULTS.openingWidthMm,
    openingHMm: SLAB_DEFAULTS.openingHeightMm,
    labelWMm: SLAB_DEFAULTS.labelWidthMm,
    labelHMm: SLAB_DEFAULTS.labelHeightMm,
    bleedMm: SLAB_DEFAULTS.bleedMm,
    safeMm: SLAB_DEFAULTS.safeMm,
    ...overrides,
  }) as ISlabLabel;

describe("slab geometry", () => {
  it("uses the dimensions from the holder manufacturer's spec sheet", () => {
    // Sent by the client 2026-08-06 as 5.35 × 3.15 × 0.27 in. These are the
    // numbers a physical holder is actually made to, so a mismatch prints a
    // label that does not fit — the failure is only discovered after printing.
    expect(SLAB_DEFAULTS.widthMm).toBe(80);
    expect(SLAB_DEFAULTS.heightMm).toBe(136);
    expect(SLAB_DEFAULTS.openingWidthMm).toBe(64);
    expect(SLAB_DEFAULTS.openingHeightMm).toBe(90);
    expect(SLAB_DEFAULTS.labelWidthMm).toBe(70);
    expect(SLAB_DEFAULTS.labelHeightMm).toBe(20);
  });

  it("renders an old label at the dimensions it was sold at", () => {
    // Labels store their own copy of every dimension precisely so a spec change
    // cannot silently re-cut a slab someone already paid for. This asserts the
    // 2026-07-29 spec still lays out from a stored document, not from the
    // constants above.
    const legacy = computeLayout(
      labelWithDefaults({ heightMm: 135, openingWMm: 65 }),
    );

    expect(legacy.canvasHeight).toBe(mmToPx(135 + SLAB_DEFAULTS.bleedMm * 2));
    expect(legacy.openingWidth).toBe(mmToPx(65));
    expect(legacy.canvasHeight).not.toBe(SLAB_CANVAS_PX.height);
  });

  it("derives a canvas matching the published export size", () => {
    const layout = computeLayout(labelWithDefaults());

    expect(layout.canvasWidth).toBe(SLAB_CANVAS_PX.width);
    expect(layout.canvasHeight).toBe(SLAB_CANVAS_PX.height);
  });

  it("places the label band ABOVE the card window", () => {
    const layout = computeLayout(labelWithDefaults());

    // The v1 layout had these the other way round. This is the assertion that
    // fails if the band is ever moved back below the window.
    expect(layout.labelY + layout.labelHeight).toBeLessThanOrEqual(
      layout.openingY,
    );
  });

  it("keeps the band and the window inside the trim", () => {
    const layout = computeLayout(labelWithDefaults());

    expect(layout.labelY).toBeGreaterThanOrEqual(layout.trimY);
    expect(layout.labelX).toBeGreaterThanOrEqual(layout.trimX);
    expect(layout.labelX + layout.labelWidth).toBeLessThanOrEqual(
      layout.trimX + layout.trimWidth,
    );
    expect(layout.openingY + layout.openingHeight).toBeLessThanOrEqual(
      layout.trimY + layout.trimHeight,
    );
  });

  it("centres the band and the window horizontally", () => {
    const layout = computeLayout(labelWithDefaults());

    // Within a pixel: coordinates are rounded to whole pixels, so an odd
    // leftover margin lands half a pixel off centre by construction.
    const trimCentre = layout.trimX + layout.trimWidth / 2;
    expect(
      Math.abs(layout.labelX + layout.labelWidth / 2 - trimCentre),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(layout.openingX + layout.openingWidth / 2 - trimCentre),
    ).toBeLessThanOrEqual(1);
  });

  it("leaves more room below the window than between band and window", () => {
    const layout = computeLayout(labelWithDefaults());

    const gapAbove = layout.openingY - (layout.labelY + layout.labelHeight);
    const gapBelow =
      layout.trimY +
      layout.trimHeight -
      (layout.openingY + layout.openingHeight);

    expect(gapAbove).toBeGreaterThan(0);
    expect(gapBelow).toBeGreaterThan(gapAbove);
  });

  it("reads dimensions from the label, not the constants", () => {
    // A label sold at the old v1 size must keep rendering at that size.
    const legacy = computeLayout(
      labelWithDefaults({ widthMm: 94, heightMm: 138 } as Partial<ISlabLabel>),
    );

    expect(legacy.trimWidth).toBe(mmToPx(94));
    expect(legacy.trimHeight).toBe(mmToPx(138));
  });

  it("does not push the window off-canvas when the parts do not fit", () => {
    // A bad spec must degrade to a cramped layout, not a window rendered past
    // the bottom edge where sharp would throw on composite.
    const overfull = computeLayout(
      labelWithDefaults({ heightMm: 100 } as Partial<ISlabLabel>),
    );

    expect(overfull.openingY).toBeGreaterThanOrEqual(
      overfull.labelY + overfull.labelHeight,
    );
    expect(overfull.openingY).toBeLessThan(overfull.canvasHeight);
  });
});
