import sharp from "sharp";
import {
  BAND_FROST_BRIGHTNESS,
  BAND_SCRIM_OPACITY,
  SLAB_DEFAULTS,
} from "../app/constants";
import {
  buildCaseLayer,
  buildFrostedBand,
  buildTextLayer,
  compositePng,
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
  // The PixelGrade wordmark was replaced by the owner's identity on 2026-07-30.
  ownerUsername: "omar_mendoza",
  ownerInitials: "OM",
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
  // BOLD mixed-case (`font-weight: 700`), not body text. This sat at 0.55 —
  // the body figure — which made the overflow test below measure the handle as
  // narrower than it draws and report a real collision as clearance. A
  // 12-character handle overhung the divider into the card-name column for as
  // long as both numbers agreed with each other and not with the renderer.
  handle: 0.62,
  initials: 0.6,
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

  it("does not let the owner handle run into the card name", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts } = boxesOf(svg);

    const handle = requireText(
      texts,
      (t) => t.cls === "handle",
      "the owner handle",
    );
    const name = requireText(
      texts,
      (t) => t.value.startsWith("Chespin"),
      "the card name",
    );

    expect(extentOf(handle).right).toBeLessThanOrEqual(extentOf(name).left);
  });

  it("keeps the handle inside its own column, at any legal length", () => {
    // The previous assertion only compared the handle against the card NAME,
    // which starts well right of the divider — so a handle could overhang its
    // column and still pass. This measures it against the column itself.
    //
    // 24 characters is the maximum a username may be (`usernameSchema`), so
    // this is the worst case that can reach a printed slab, not a synthetic one.
    for (const username of ["ab", "omar_mendoza", "a".repeat(24)]) {
      const svg = buildTextLayer(layout, {
        ...baseText,
        ownerUsername: username,
      }).toString();
      const { texts } = boxesOf(svg);

      const handle = requireText(
        texts,
        (t) => t.cls === "handle",
        `the owner handle for "${username}"`,
      );
      const { left, right } = extentOf(handle);

      // Column geometry, mirroring slab.composite.ts.
      const padX = Math.round(layout.labelWidth * 0.035);
      const ownerX = layout.labelX + padX;
      const ownerW = Math.round((layout.labelWidth - padX * 2) * 0.17);

      expect(left).toBeGreaterThanOrEqual(ownerX - 1);
      expect(right).toBeLessThanOrEqual(ownerX + ownerW + 1);
    }
  });

  it("prints the owner's handle, not the PixelGrade wordmark", () => {
    const svg = buildTextLayer(layout, baseText).toString();

    expect(svg).toContain("@omar_mendoza");
    // The wordmark shared this column until 2026-07-30; both cannot fit.
    expect(svg).not.toContain(">PIXEL<");
    expect(svg).not.toContain(">GRADE<");
  });

  it("falls back to an initial disc when the owner has no avatar", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts } = boxesOf(svg);

    // No avatar data URI in baseText, so the disc carries initials instead of
    // leaving an empty hole where the identity column should be.
    expect(texts.some((t) => t.cls === "initials" && t.value === "OM")).toBe(
      true,
    );
  });

  it("composites the avatar clipped to a circle when one is supplied", () => {
    const svg = buildTextLayer(layout, {
      ...baseText,
      ownerAvatarDataUri: "data:image/png;base64,iVBORw0KGgo=",
    }).toString();

    // A square avatar printed square would read as a sticker, not a profile.
    expect(svg).toContain('clip-path="url(#pg-avatar-clip)"');
    expect(svg).not.toContain('class="initials"');
  });

  it("stacks the Pixel ID beneath the QR rather than beside it", () => {
    const svg = buildTextLayer(layout, {
      ...baseText,
      qrDataUri: "data:image/png;base64,iVBORw0KGgo=",
    }).toString();
    const { texts, images } = boxesOf(svg);

    const qr = images[images.length - 1];
    const caption = requireText(
      texts,
      (t) => t.value === "PIXEL ID",
      "the PIXEL ID caption",
    );
    const value = requireText(
      texts,
      (t) => t.value === baseText.pixelId,
      "the Pixel ID",
    );

    // Both share the QR's horizontal centre — that is what "below the QR"
    // means here, and it is what freed the column the card info expanded into.
    const qrCentre = qr.x + qr.width / 2;
    expect(Math.abs(caption.x - qrCentre)).toBeLessThanOrEqual(1);
    expect(Math.abs(value.x - qrCentre)).toBeLessThanOrEqual(1);
    expect(caption.anchorMiddle).toBe(true);
    expect(value.anchorMiddle).toBe(true);
  });

  it("keeps the QR on an opaque plate so it still scans off frosted glass", () => {
    const svg = buildTextLayer(layout, {
      ...baseText,
      qrDataUri: "data:image/png;base64,iVBORw0KGgo=",
    }).toString();

    // The band shows the artwork through it now; a QR read against whatever
    // happens to be underneath will not scan.
    expect(svg).toContain('fill="#FFFFFF"');
  });

  it("gives the card information column room for a long name", () => {
    // The widened column (UI Feedback v1 edit #4) is the whole point of moving
    // the Pixel ID under the QR. A long name used to shrink to the low 20s in
    // the old four-column band; if someone narrows the column again, this fires
    // before a slab is printed with unreadable type.
    const svg = buildTextLayer(layout, {
      ...baseText,
      cardName: "Iono's Bellibolt ex",
    }).toString();
    const { texts } = boxesOf(svg);

    const name = requireText(
      texts,
      (t) => t.cls === "name",
      "the card name",
    );

    expect(name.size).toBeGreaterThanOrEqual(32);
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

/**
 * The band's frosted treatment (client feedback 2026-07-30).
 *
 * The point of the change was to let the artwork show through the band. The
 * risk it introduces is the opposite failure: a bright backdrop bleeding
 * through far enough to take the white label text with it. A printed slab
 * cannot be un-printed, so the contrast floor is asserted as arithmetic rather
 * than trusted to the two constants staying sensible.
 */
describe("label band frosting", () => {
  /** Relative luminance of a neutral grey at `value`/255, per WCAG. */
  const luminance = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  /** Contrast of white text against a neutral backdrop at `value`/255. */
  const contrastAgainstWhite = (value: number): number =>
    1.05 / (luminance(value) + 0.05);

  it("keeps white label text legible over the brightest possible artwork", () => {
    // Worst case: pure white artwork behind the band. Dimmed by the frost, then
    // composited under the scrim over near-black.
    const dimmed = 255 * BAND_FROST_BRIGHTNESS;
    const behindText = dimmed * (1 - BAND_SCRIM_OPACITY);

    // 4.5:1 is the WCAG floor for body text; the band is also printed, where
    // dot gain eats margin, so this is deliberately not a bare pass.
    expect(contrastAgainstWhite(behindText)).toBeGreaterThan(7);
  });

  it("still lets enough artwork through to read as glass", () => {
    // The mirror of the test above: a scrim opaque enough to guarantee any
    // contrast would also hide the scene, which is the thing the client
    // rejected. Mid-grey artwork must survive to a visible level.
    const midGrey = 128 * BAND_FROST_BRIGHTNESS * (1 - BAND_SCRIM_OPACITY);
    expect(midGrey).toBeGreaterThan(12);
  });

  it("returns a band-sized, rounded, opaque-cornered panel", async () => {
    const background = await sharp({
      create: {
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const band = await buildFrostedBand(background, layout);
    const { width, height, channels } = await sharp(band).metadata();

    expect(width).toBe(layout.labelWidth);
    expect(height).toBe(layout.labelHeight);
    // Rounded corners are cut with an alpha mask; without a fourth channel the
    // corners would print square behind the scrim's radius.
    expect(channels).toBe(4);
  });

  it("dims the artwork it sits on", async () => {
    const background = await sharp({
      create: {
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const band = await buildFrostedBand(background, layout);
    const { channels: stats } = await sharp(band).stats();

    // White in, meaningfully darker out — the frost is doing its half of the
    // legibility contract and not just blurring.
    expect(stats[0].mean).toBeLessThan(255 * 0.75);
  });

  it("draws the scrim at the opacity the contrast maths assumes", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    expect(svg).toContain(`fill-opacity="${BAND_SCRIM_OPACITY}"`);
  });
});

/**
 * The card window (reported from a real render, 2026-07-30).
 *
 * A landscape JPEG scan letterboxed into the portrait window came out with
 * solid black bars above and below the card instead of the artwork showing
 * through. The cause was format, not geometry: `toBuffer()` preserves the input
 * format, and JPEG has no alpha, so the transparent padding was flattened to
 * black. Nothing throws — it just prints wrong.
 */
describe("card window", () => {
  /** A landscape JPEG, i.e. exactly what a phone scan looks like. */
  const landscapeJpeg = () =>
    sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: { r: 200, g: 30, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();

  /** A canvas-sized solid green background, easy to spot through a letterbox. */
  const greenBackground = () =>
    sharp({
      create: {
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        channels: 3,
        background: { r: 0, g: 180, b: 0 },
      },
    })
      .png()
      .toBuffer();

  it("lets the artwork show through the letterbox instead of printing black bars", async () => {
    const png = await compositePng(
      layout,
      await greenBackground(),
      await landscapeJpeg(),
      baseText,
      // The case draws a gloss over the whole trim; without it the sample below
      // is the composite's own output rather than plastic on top of it.
      { showCase: false },
    );

    // Sample just inside the top edge of the card window. A 600x400 image
    // contained into a 65x90 window letterboxes heavily top and bottom, so this
    // point is padding — it must be the background, not black.
    const { data } = await sharp(png)
      .extract({
        left: layout.openingX + Math.round(layout.openingWidth / 2),
        top: layout.openingY + 4,
        width: 1,
        height: 1,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const [r, g, b] = data;
    expect(g).toBeGreaterThan(120);
    expect(r).toBeLessThan(90);
    expect(b).toBeLessThan(90);
  });

  it("honours EXIF orientation so a phone scan is not composited sideways", async () => {
    // Orientation 6 = "rotate 90° clockwise on display", which is what a phone
    // writes for a portrait shot. sharp ignores the tag unless `.rotate()` is
    // called, so without it the card lands on its side in the window.
    const rotated = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 3,
        background: { r: 10, g: 10, b: 200 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    // Metadata has to be read off the RENDERED buffer, not the pipeline —
    // `metadata()` describes the source image and would report the pre-rotation
    // dimensions whether or not `.rotate()` was ever applied.
    const oriented = await sharp(
      await sharp(rotated).rotate().png().toBuffer(),
    ).metadata();

    // 400x600 tagged "turn it" renders as 600x400. If this ever reads 400x600
    // the pipeline is not applying the tag.
    expect(oriented.width).toBe(600);
    expect(oriented.height).toBe(400);
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
