import { SLAB_DEFAULTS, SLAB_CANVAS_PX } from "../app/constants";
import { computeLayout, mmToPx } from "../app/modules/slab/slab.geometry";
import { ISlabLabel } from "../app/modules/slab/slab.interface";

/**
 * Slab geometry, against the dimensions the client confirmed on 2026-07-29.
 *
 * The label band moved from below the card window to above it, which changed
 * how the window's position is derived. These assertions pin the relationships
 * that the printed slab depends on — a regression here produces a label that
 * looks fine on screen and is wrong on paper.
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
  it("uses the client-confirmed v2 dimensions as defaults", () => {
    expect(SLAB_DEFAULTS.widthMm).toBe(80);
    expect(SLAB_DEFAULTS.heightMm).toBe(135);
    expect(SLAB_DEFAULTS.openingWidthMm).toBe(65);
    expect(SLAB_DEFAULTS.openingHeightMm).toBe(90);
    expect(SLAB_DEFAULTS.labelWidthMm).toBe(70);
    expect(SLAB_DEFAULTS.labelHeightMm).toBe(20);
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
