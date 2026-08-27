import sharp from "sharp";
import {
  BAND_FROST_BRIGHTNESS,
  BAND_SCRIM_OPACITY,
  SLAB_DEFAULTS,
} from "../app/constants";
import {
  bandCaptionLead,
  bandColumns,
  bandRadius,
  bandRails,
  bandRowLead,
  buildCaseLayer,
  buildFrostedBand,
  buildTextLayer,
  CAP_RATIO,
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
  // 0.56, measured. This sat at 0.78 — the generic bold-caps figure — against
  // a run that rasterises at 0.508em per character in DejaVu Sans Bold, so the
  // test modelled "PIXEL VERIFIED" as ~35% wider than it draws. That is the
  // same class of error as the handle above, pointed the other way: an estimate
  // too PESSIMISTIC reports clearance as a collision, and the cost is that the
  // badge has to be kept artificially small to satisfy a number no renderer
  // agrees with. Both directions are only fixable by measuring.
  verified: 0.56,
  // The Pixel ID value, uppercase alphanumeric: 0.554em bare. Was drawn in the
  // `meta` class until 2026-08-25 and inherited its mixed-case figure.
  idvalue: 0.62,
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
      /<text x="([\d.]+)" y="([\d.]+)"[^>]*class="(\w+)" font-size="(\d+)"([^>]*)>([^<]*)<\/text>/g,
    ),
  ].map((m) => {
    const [, x, y, cls, size, attrs, value] = m;
    const fontSize = Number(size);
    // The rendered extent: glyph advances plus the gap letter-spacing inserts
    // between them. Leaving tracking out is what let the mutation slip past.
    const width =
      value.length * fontSize * (ADVANCE[cls] ?? 0.6) +
      Math.max(0, value.length - 1) * trackingOf(svg, cls);

    return {
      x: Number(x),
      // An SVG `y` is the BASELINE. `capTop` is what the band aligns on, and
      // the two only coincide for runs that happen to share a font size —
      // which is exactly why comparing `y` values would not catch the
      // misalignment the rails fix.
      baseline: Number(y),
      capTop: Number(y) - fontSize * CAP_RATIO,
      cls,
      size: fontSize,
      width,
      anchorEnd: attrs.includes('text-anchor="end"'),
      anchorMiddle: attrs.includes('text-anchor="middle"'),
      value,
    };
  });

  const images = [
    ...svg.matchAll(/<image x="([\d.]+)" y="([\d.]+)"[^>]*width="(\d+)"/g),
  ].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    width: Number(m[3]),
  }));

  return { texts, images };
};

/** The white plate the QR is drawn on — its edge, not the code inside it, is
 *  what the eye reads as the code's top. */
const qrPlateOf = (svg: string) => {
  const m = /<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)" rx="4"/.exec(
    svg,
  );
  if (!m) throw new Error("Expected the band to contain the QR plate");
  return { x: Number(m[1]), y: Number(m[2]), size: Number(m[3]) };
};

const rails = bandRails(layout.labelY, layout.labelHeight);
const lead = bandRowLead(layout.labelHeight);
const capLead = bandCaptionLead(layout.labelHeight);

// Column geometry, IMPORTED from slab.composite.ts rather than re-derived here.
// It used to be a hand-copied set of fractions, and it silently drifted every
// time a column width moved: the copy still measured a coherent band, just not
// the one being drawn, so the collision assertions below went on passing while
// checking nothing. The card-information column's left edge identifies its rows
// — `meta` and `micro` are also used by the QR column, and filtering on class
// alone would mix the two columns' rows.
const cols = bandColumns(layout.labelX, layout.labelWidth);
const { infoX } = cols;

/** The Pixel Verified mark and the gap between it and its words. Mirrors the
 *  two figures in `buildTextLayer`; the badge is laid out as one unit — icon,
 *  gap, text — so any assertion about where it starts has to add them back. */
const badgeIcon = Math.round(layout.labelHeight * 0.096);
const badgeIconGap = Math.round(badgeIcon * 0.35);

/** Top of the Pixel Verified disc, read off the group's own transform. */
const iconTopOf = (svg: string): number => {
  const m = /<g transform="translate\([\d.]+ ([\d.]+)\) scale\(/.exec(svg);
  if (!m) throw new Error("Expected the band to contain the Pixel Verified mark");
  return Number(m[1]);
};

/** Everything in the band carries a data URI, so the avatar and the QR render
 *  as `<image>` rather than falling back to the initial disc. */
const fullText: LabelText = {
  ...baseText,
  qrDataUri: "data:image/png;base64,iVBORw0KGgo=",
  ownerAvatarDataUri: "data:image/png;base64,iVBORw0KGgo=",
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

      expect(left).toBeGreaterThanOrEqual(cols.ownerX - 1);
      expect(right).toBeLessThanOrEqual(cols.ownerX + cols.ownerW + 1);
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

  it("does not let the Pixel Verified badge run into the Pixel ID", () => {
    // The shipped bug (fixed 2026-08-24): the badge was sized against the
    // card-information column and drawn centred in the grade column, so it
    // printed ~70% wider than its space and struck straight through the Pixel
    // ID on every verified slab. Nothing here failed — the old suite measured
    // the badge against the band's outer edges, which it never crossed.
    const svg = buildTextLayer(layout, {
      ...baseText,
      qrDataUri: "data:image/png;base64,iVBORw0KGgo=",
    }).toString();
    const { texts } = boxesOf(svg);

    const badge = requireText(
      texts,
      (t) => t.cls === "verified",
      "the Pixel Verified badge",
    );
    const id = requireText(
      texts,
      (t) => t.value === baseText.pixelId,
      "the Pixel ID",
    );

    // The badge is drawn from its left edge with the icon ahead of it, so the
    // icon's own width has to be carried into the measurement.
    const badgeRight = extentOf(badge).right;

    expect(badgeRight).toBeLessThanOrEqual(extentOf(id).left);
    expect(extentOf(badge).left - badgeIcon - badgeIconGap).toBeGreaterThan(
      layout.labelX,
    );
  });

  it("keeps the Pixel Verified badge on the grade's side of the divider", () => {
    const svg = buildTextLayer(layout, baseText).toString();
    const { texts } = boxesOf(svg);

    const badge = requireText(
      texts,
      (t) => t.cls === "verified",
      "the Pixel Verified badge",
    );

    // The icon leads the run, so the badge's true left edge is the icon's.
    expect(extentOf(badge).left - badgeIcon - badgeIconGap).toBeGreaterThanOrEqual(
      cols.gradeLeft - cols.gap / 2,
    );
  });

  it("rules every column boundary, to one shared depth", () => {
    // Three rules, not one (2026-08-25, matching the client's reference band).
    // The depth is the point as much as the count: three rules ending at three
    // different places is the ragged strip the rails were introduced to fix,
    // turned ninety degrees, and it is invisible in any single column.
    const svg = buildTextLayer(layout, fullText).toString();
    const rules = [
      ...svg.matchAll(
        /<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/g,
      ),
    ].map((m) => ({
      x: Number(m[1]),
      top: Number(m[2]),
      bottom: Number(m[4]),
    }));

    expect(rules).toHaveLength(3);
    for (const rule of rules) {
      expect(rule.top).toBe(rails.top);
      expect(rule.bottom).toBe(rules[0].bottom);
      // A rule taken to the band's floor leaves a stub hanging below every
      // column it brackets — the floor belongs to the QR column alone.
      expect(rule.bottom).toBeLessThan(rails.bottom);
    }

    // One per boundary, each sitting in the gap between the columns it divides.
    expect(rules.map((r) => r.x)).toEqual([
      infoX - cols.gap / 2,
      cols.gradeLeft - cols.gap / 2,
      cols.qrColLeft - cols.gap / 2,
    ]);
  });

  it("sets the Pixel ID's caption above its value, not the other way round", () => {
    // The caption is what tells a reader what the string IS, and the string is
    // a machine identifier beneath a code that resolves the same page. Until
    // 2026-08-25 the value was the larger and both were full white, which made
    // the band's densest column compete with the grade.
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts } = boxesOf(svg);

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

    expect(value.size).toBeLessThan(caption.size);
    expect(value.cls).toBe("idvalue");
    // Updated fill to crisp #FFFFFF per client print legibility request
    expect(svg).toMatch(/\.idvalue\s*\{[^}]*fill:\s*#FFFFFF/);
  });

  it("draws the Pixel Verified mark as a disc, legible at 2 mm", () => {
    // A shield's silhouette is mush at this size; the whole point of a mark
    // this small is that it is recognisable at a glance.
    const svg = buildTextLayer(layout, fullText).toString();

    expect(svg).toContain('<circle cx="12" cy="12" r="11" fill="#8B5CF6" />');
  });

  it("centres the badge's words on its mark rather than sharing a cap line", () => {
    // A 23 px disc and a 15 px word hung from one top read as the word having
    // slipped down. Every OTHER row in the band shares a cap top; this is the
    // one place that rule does not apply, so it is worth pinning.
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts } = boxesOf(svg);

    const badge = requireText(
      texts,
      (t) => t.cls === "verified",
      "the Pixel Verified badge",
    );

    const iconTop = iconTopOf(svg);
    const iconCentre = iconTop + badgeIcon / 2;
    const textCentre = badge.baseline - (badge.size * CAP_RATIO) / 2;

    expect(Math.abs(textCentre - iconCentre)).toBeLessThanOrEqual(1);
  });

  it("draws the shield only for a genuinely verified report", () => {
    // Invariant 4: the badge is a server-awarded claim. A slab that prints it
    // unconditionally empties it of the meaning the award gate protects.
    const verified = buildTextLayer(layout, baseText).toString();
    const plain = buildTextLayer(layout, {
      ...baseText,
      pixelVerified: false,
    }).toString();

    expect(verified).toContain("PIXEL VERIFIED");
    expect(verified).toContain('fill="#8B5CF6"');
    expect(plain).not.toContain("PIXEL VERIFIED");
    expect(plain).not.toContain('fill="#8B5CF6"');
  });

  it("rounds the scrim to the same radius the frosted backdrop is cut to", () => {
    // Both are drawn by different renderers — SVG here, a sharp alpha mask in
    // buildFrostedBand — and each carried its own copy of the figure until they
    // were centralised. A mismatch prints square shoulders behind a round panel.
    const svg = buildTextLayer(layout, baseText).toString();
    const radius = bandRadius(layout.labelHeight);

    expect(svg).toContain(`rx="${radius}" ry="${radius}"`);
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
 * The band's vertical rails (client, 2026-08-24: "the top of the logo, the
 * grade section, and the QR code should follow the same horizontal alignment").
 *
 * Same failure mode as the column tiling above, turned ninety degrees: every
 * run used to carry its own fraction of the band height, so the column heads
 * started on three different lines. Nothing throws, nothing looks broken in
 * isolation — it just prints as a ragged strip. These pin the two rails.
 */
describe("slab label band vertical rails", () => {
  it("hangs the avatar, the card name, the grade and the QR from one top line", () => {
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts, images } = boxesOf(svg);

    // The avatar is drawn first, the QR last.
    const avatar = images[0];
    const plate = qrPlateOf(svg);
    const grade = requireText(
      texts,
      (t) => t.cls === "grade",
      "the grade",
    );
    const name = requireText(texts, (t) => t.cls === "name", "the card name");

    expect(avatar.y).toBe(rails.top);
    expect(plate.y).toBe(rails.top);
    // Text is anchored by the top of its glyphs, so the comparison has to
    // convert the baseline back — aligning the `y` values instead would put a
    // 99 px numeral and a 47 px name ~37 px apart and still pass.
    expect(Math.abs(grade.capTop - rails.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(name.capTop - rails.top)).toBeLessThanOrEqual(1);
  });

  it("keeps the top line whether or not the report is Pixel Verified", () => {
    // The grade used to drop from 0.45 to 0.55 of the band when the badge was
    // absent, so two slabs printed side by side had their grades on different
    // lines depending on how the card was scanned.
    const verified = boxesOf(buildTextLayer(layout, fullText).toString());
    const plain = boxesOf(
      buildTextLayer(layout, { ...fullText, pixelVerified: false }).toString(),
    );

    const gradeOf = (b: ReturnType<typeof boxesOf>) =>
      requireText(b.texts, (t) => t.cls === "grade", "the grade");

    expect(gradeOf(plain).baseline).toBe(gradeOf(verified).baseline);
    expect(Math.abs(gradeOf(plain).capTop - rails.top)).toBeLessThanOrEqual(1);
  });

  it("sets the grade's word directly beneath the numeral, not adrift below it", () => {
    // Client, 2026-08-24: "can you move up the NM info more higher up". The
    // word names the numeral; spread over the band it sat ~2.5 mm clear of it
    // and read as an unrelated caption.
    //
    // The bound is `bandRowLead`, not a figure of its own. What this is really
    // asserting is that the pair is set TIGHTER than an ordinary step down a
    // column — which is the client's note — and pinning the exact fraction
    // instead is what made this fail when the word nearly doubled in size on
    // 2026-08-25 and its lead had to grow with it.
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts } = boxesOf(svg);

    const grade = requireText(texts, (t) => t.cls === "grade", "the grade");
    const word = requireText(
      texts,
      (t) => t.cls === "glabel",
      "the grade label",
    );

    const gradeLead = word.capTop - grade.baseline;

    expect(gradeLead).toBeGreaterThan(0);
    expect(gradeLead).toBeLessThan(lead);
  });

  it("tucks the handle under the avatar instead of sinking it to the floor", () => {
    // The first pass at the rails pulled every column's last row down onto
    // `rails.bottom`, which put ~6 mm of nothing between the avatar and the
    // handle that captions it. Client, 2026-08-24: "between profile image and
    // @username decrease the gap as before."
    //
    // Tightened again on 2026-08-25 to the CAPTION lead ("the gap is too much,
    // need minimal space"). This column's head is an image, and that is why it
    // is the one head that does not take `bandRowLead`: a disc's drawn edge is
    // its measured edge, where a word carries sidebearings and a descender
    // below the cap height it is measured by — so the same lead buys visibly
    // more air under a disc than under a name.
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts, images } = boxesOf(svg);

    const avatarBottom = images[0].y + images[0].width;
    const handle = requireText(
      texts,
      (t) => t.cls === "handle",
      "the owner handle",
    );

    expect(
      Math.abs(handle.capTop - avatarBottom - capLead),
    ).toBeLessThanOrEqual(1);
    // Tighter than the card name's step down, which is the point.
    expect(handle.capTop - avatarBottom).toBeLessThan(lead);
  });

  /** The card-information column's rows, in draw order. */
  const infoRowsOf = (svg: string) =>
    boxesOf(svg).texts.filter(
      (t) => ["name", "meta", "micro"].includes(t.cls) && t.x === infoX,
    );

  /**
   * The column's two leads: `bandRowLead` below the card NAME, which is this
   * column's head, and the tighter `bandCaptionLead` between every row after
   * it. ±1 because baselines are rounded to whole pixels and cap heights are
   * not.
   */
  const expectColumnRhythm = (rows: ReturnType<typeof infoRowsOf>) => {
    for (let i = 1; i < rows.length; i++) {
      const gap = rows[i].capTop - rows[i - 1].baseline;
      expect(Math.abs(gap - (i === 1 ? lead : capLead))).toBeLessThanOrEqual(1);
    }
  };

  it("sets the card's set and number tight under its name", () => {
    // Client, same round: "below card name address and language … remove much
    // space". Spread to the floor the three rows read as unrelated lines rather
    // than as one card's details.
    const rows = infoRowsOf(buildTextLayer(layout, fullText).toString());

    expect(rows).toHaveLength(3);
    expectColumnRhythm(rows);
  });

  it("holds a wrapped set name together as one name, not two rows", () => {
    // The set line wraps to two rows, and at 2026-08-25 both steps in this
    // column were `bandRowLead` — so "Crown Zenith" and "Galarian Gallery" were
    // spaced exactly as far apart as the card's name was from its set, and the
    // one name read as two unrelated lines. The caption lead is what binds
    // them. This is the assertion the uniform-leading version could not make.
    const svg = buildTextLayer(layout, {
      ...fullText,
      setExpansion: "Scarlet & Violet Paldean Fates Special Set",
    }).toString();
    const rows = infoRowsOf(svg);

    expect(rows).toHaveLength(4);
    expectColumnRhythm(rows);

    // Explicitly: the wrapped pair is closer together than the name is to it.
    const headStep = rows[1].capTop - rows[0].baseline;
    const wrapStep = rows[2].capTop - rows[1].baseline;

    expect(wrapStep).toBeLessThan(headStep);
  });

  it("keeps the Pixel ID on the floor — the QR column is the one that reaches it", () => {
    // The QR plate eats most of the distance between the rails, so this column
    // has no slack to tighten; spreading is what keeps the id off the band's
    // bottom edge rather than pushing it through it.
    const svg = buildTextLayer(layout, fullText).toString();
    const { texts } = boxesOf(svg);

    const id = requireText(
      texts,
      (t) => t.value === baseText.pixelId,
      "the Pixel ID",
    );

    expect(Math.abs(id.baseline - rails.bottom)).toBeLessThanOrEqual(1);
  });

  it.each<[string, Partial<LabelText>]>([
    ["decimal grade + longest label", { grade: 8.5, gradeLabel: "GEM-MT" }],
    ["longest legal handle", { ownerUsername: "a".repeat(24) }],
    ["long card name", { cardName: "Iono's Bellibolt ex" }],
    ["no optional fields", {
      setExpansion: undefined, cardNumber: undefined,
      language: undefined, year: undefined, pixelVerified: false,
    }],
  ])("keeps every row inside the band with %s", (_label, overrides) => {
    const svg = buildTextLayer(layout, { ...fullText, ...overrides }).toString();
    const { texts, images } = boxesOf(svg);

    const bandTop = layout.labelY;
    const bandBottom = layout.labelY + layout.labelHeight;

    for (const t of texts) {
      expect(t.capTop).toBeGreaterThanOrEqual(bandTop);
      // Descenders hang below the baseline; "@omar_mendoza" has one, and a
      // baseline flush to the band's edge would clip its tail off in print.
      expect(t.baseline + t.size * 0.21).toBeLessThanOrEqual(bandBottom);
    }
    for (const img of images) {
      expect(img.y).toBeGreaterThanOrEqual(bandTop);
      expect(img.y + img.width).toBeLessThanOrEqual(bandBottom);
    }
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
    //
    // The floor moved 12 → 6 when the band was darkened to match the client's
    // reference on 2026-08-25. Read it against what it is protecting rather
    // than as a number: the scrim's own near-black contributes ~9 levels, so at
    // 8.7 a mid-grey backdrop is still HALF of what is drawn in the band, and
    // the panel carries the artwork's colour. Below ~6 the scene stops being
    // half of anything and the band is the flat plate again.
    const midGrey = 128 * BAND_FROST_BRIGHTNESS * (1 - BAND_SCRIM_OPACITY);
    expect(midGrey).toBeGreaterThan(6);
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

  it("puts a moulded tab on left and right sides", () => {
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
