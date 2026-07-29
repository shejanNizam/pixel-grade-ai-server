import { SLAB_DEFAULTS } from "../app/constants";
import {
  buildCaseLayer,
  buildTextLayer,
  formatGrade,
  LabelText,
} from "../app/modules/slab/slab.composite";
import { computeLayout } from "../app/modules/slab/slab.geometry";
import { ISlabLabel } from "../app/modules/slab/slab.interface";

/**
 * The label band and the slab case are the printed product. Both are pure
 * string builders, so their geometry can be asserted directly — which matters
 * because the failure mode is silent: overlapping columns still render, they
 * just render wrong, and nobody finds out until a slab is printed.
 *
 * The band originally positioned each column from its own fraction of the
 * width, which let the wordmark collide with the card name and the grade print
 * on top of the Pixel ID. These tests pin the tiling that replaced it.
 */

const layout = computeLayout({
  widthMm: SLAB_DEFAULTS.widthMm,
  heightMm: SLAB_DEFAULTS.heightMm,
  openingWMm: SLAB_DEFAULTS.openingWidthMm,
  openingHMm: SLAB_DEFAULTS.openingHeightMm,
  labelWMm: SLAB_DEFAULTS.labelWidthMm,
  labelHMm: SLAB_DEFAULTS.labelHeightMm,
  bleedMm: SLAB_DEFAULTS.bleedMm,
  safeMm: SLAB_DEFAULTS.safeMm,
} as ISlabLabel);

const baseText: LabelText = {
  cardName: "Chespin",
  setExpansion: "White Flare",
  cardNumber: "087/086",
  language: "EN",
  year: "2026",
  grade: 10,
  gradeLabel: "MINT",
  pixelVerified: true,
  pixelId: "PG-000087FG",
};

/**
 * Average glyph advance per style class, as a fraction of the font size.
 *
 * Per-class rather than one global number, because that is precisely what the
 * original bug turned on: bold uppercase runs ~0.78em against ~0.55em for
 * mixed-case body text, so a single optimistic estimate reports a collision as
 * clearance. Measured against the rendered output, not guessed.
 */
const ADVANCE: Record<string, number> = {
  mark: 0.78,
  name: 0.6,
  meta: 0.55,
  micro: 0.55,
  grade: 0.6,
  glabel: 0.78,
  verified: 0.78,
};

/** Reads `letter-spacing: Npx` for a class out of the SVG's <style> block. */
const trackingOf = (svg: string, cls: string): number => {
  const rule = new RegExp(`\\.${cls}\\s+\\{[^}]*\\}`).exec(svg)?.[0] ?? "";
  return Number(/letter-spacing:\s*([\d.]+)px/.exec(rule)?.[1] ?? 0);
};

/** Pulls every `<text>` and `<image>` out of the SVG with its real extents. */
const boxesOf = (svg: string) => {
  const texts = [
    ...svg.matchAll(
      /<text x="([\d.]+)"[^>]*class="(\w+)" font-size="(\d+)"([^>]*)>([^<]*)<\/text>/g,
    ),
  ].map((m) => {
    const [, x, cls, size, attrs, value] = m;
    const fontSize = Number(size);
    // The rendered extent: glyph advances plus the gap letter-spacing inserts
    // between them. Leaving tracking out is what let the mutation slip past.
    const width =
      value.length * fontSize * (ADVANCE[cls] ?? 0.6) +
      Math.max(0, value.length - 1) * trackingOf(svg, cls);

    return {
      x: Number(x),
      cls,
      size: fontSize,
      width,
      anchorEnd: attrs.includes('text-anchor="end"'),
      anchorMiddle: attrs.includes('text-anchor="middle"'),
      value,
    };
  });

  const images = [...svg.matchAll(/<image x="([\d.]+)"[^>]*width="(\d+)"/g)].map((m) => ({
    x: Number(m[1]),
    width: Number(m[2]),
  }));

  return { texts, images };
};

/** Finds a run by predicate, failing the test loudly if the band no longer
 *  contains it — a silently-absent element would make the collision
 *  assertions below vacuously true. */
const requireText = <T>(runs: T[], match: (t: T) => boolean, what: string): T => {
  const found = runs.find(match);
  if (!found) throw new Error(`Expected the band to contain ${what}`);
  return found;
};

/** Left and right edges of a run, accounting for its anchor. */
const extentOf = (t: { x: number; width: number; anchorEnd: boolean; anchorMiddle: boolean }) => {
  if (t.anchorEnd) return { left: t.x - t.width, right: t.x };
  if (t.anchorMiddle) return { left: t.x - t.width / 2, right: t.x + t.width / 2 };
  return { left: t.x, right: t.x + t.width };
};

describe("slab label band", () => {
  it("keeps every element inside the band", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts, images } = boxesOf(svg);

    const bandLeft = layout.labelX;
    const bandRight = layout.labelX + layout.labelWidth;

    for (const t of texts) {
      expect(t.x).toBeGreaterThanOrEqual(bandLeft);
      expect(t.x).toBeLessThanOrEqual(bandRight);
    }
    for (const img of images) {
      expect(img.x).toBeGreaterThanOrEqual(bandLeft);
      expect(img.x + img.width).toBeLessThanOrEqual(bandRight);
    }
  });

  it("does not let the wordmark run into the card name", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts } = boxesOf(svg);

    const mark = requireText(texts, (t) => t.value === "GRADE", "the wordmark");
    const name = requireText(
      texts,
      (t) => t.value.startsWith("Chespin"),
      "the card name",
    );

    expect(extentOf(mark).right).toBeLessThanOrEqual(extentOf(name).left);
  });

  it("does not let the grade collide with the Pixel ID", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts } = boxesOf(svg);

    const grade = requireText(
      texts,
      (t) => t.value === "10" && t.anchorMiddle,
      "the grade",
    );
    const id = requireText(
      texts,
      (t) => t.value === baseText.pixelId,
      "the Pixel ID",
    );

    expect(extentOf(grade).right).toBeLessThanOrEqual(extentOf(id).left);
  });

  it.each<[string, Partial<LabelText>]>([
    ["decimal grade + longest label", { grade: 8.5, gradeLabel: "GEM-MT" }],
    ["long card name", { cardName: "Iono's Bellibolt ex" }],
    ["long pixel id", { pixelId: "PG-A1B2C3D4E5" }],
    ["no optional fields", {
      setExpansion: undefined, cardNumber: undefined,
      language: undefined, year: undefined, pixelVerified: false,
    }],
  ])("stays inside the band with %s", (_label, overrides) => {
    const svg = buildTextLayer(layout, { ...baseText, ...overrides }).toString();
    const { texts } = boxesOf(svg);

    for (const t of texts) {
      const { left, right } = extentOf(t);

      expect(left).toBeGreaterThanOrEqual(layout.labelX - 1);
      expect(right).toBeLessThanOrEqual(layout.labelX + layout.labelWidth + 1);
    }
  });

  it("escapes card names containing XML characters", () => {
    const svg = buildTextLayer(layout, {
      ...baseText,
      cardName: "Bill & Co <x>",
    }).toString();

    expect(svg).toContain("&amp;");
    expect(svg).not.toContain("<x>");
  });
});

describe("slab case", () => {
  it("draws the case within the trim, not the bleed", () => {
    const svg = buildCaseLayer(layout).toString();
    const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)"/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
    }));

    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(layout.trimX);
      expect(r.y).toBeGreaterThanOrEqual(layout.trimY);
    }
  });

  it("keeps its rim clear of the label band and the card window", () => {
    // The rim is 3% of the trim width; the band is inset further than that on
    // an 80 mm slab. If either inset ever shrinks, the case would print over
    // the grade — which is unrecoverable on a physical slab.
    const rim = Math.round(layout.trimWidth * 0.03);

    expect(rim).toBeLessThan(layout.labelX - layout.trimX);
    expect(rim).toBeLessThan(layout.openingX - layout.trimX);
  });

  it("puts a moulded tab at top and bottom centre", () => {
    const svg = buildCaseLayer(layout).toString();
    const notches = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)"/g)].filter(
      (m) => svg.slice(m.index).includes('fill-opacity="0.5"'),
    );

    expect(notches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatGrade", () => {
  it("prints whole grades without a decimal and keeps halves", () => {
    expect(formatGrade(10)).toBe("10");
    expect(formatGrade(7)).toBe("7");
    expect(formatGrade(8.5)).toBe("8.5");
  });
});
