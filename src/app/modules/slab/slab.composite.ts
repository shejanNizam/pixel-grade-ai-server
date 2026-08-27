import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  BAND_FROST_BLUR_SIGMA,
  BAND_FROST_BRIGHTNESS,
  BAND_SCRIM_OPACITY,
  SLAB_EXPORT_DPI,
} from "../../constants";
import { SlabLayout } from "./slab.geometry";

/**
 * Server-side compositing.
 *
 * The AI generates the background and nothing else. The card image and the
 * label text are drawn here, at fixed coordinates, so a bad or adversarial
 * generation cannot shift the card window or corrupt the label — the template
 * literally cannot break, because the template is code.
 */

export interface LabelText {
  cardName: string;
  setExpansion?: string;
  cardNumber?: string;
  language?: string;
  /** Release year, shown above the set name in the approved design. */
  year?: string;
  grade: number;
  gradeLabel: string;
  pixelVerified: boolean;
  /** Renamed from "cert number" per client feedback 2026-07-29 — the printed
   *  band reads "PIXEL ID", not "CERT PG". The value format is unchanged, so
   *  labels already issued keep the same identifier. */
  pixelId: string;
  /** Pre-rendered QR as a data URI, drawn into the band's right-hand slot.
   *  Optional so the label still composites if QR generation fails. */
  qrDataUri?: string;
  /** The slab owner's public handle, printed under their avatar in the band's
   *  first column (client, UI Feedback v1 edit #4 — it replaced the PixelGrade
   *  wordmark). Optional: accounts predate the username field. */
  ownerUsername?: string;
  /** The owner's avatar as a data URI. Optional — a remote URL cannot be used,
   *  because librsvg will not fetch one, and a missing avatar falls back to an
   *  initial disc drawn in code. */
  ownerAvatarDataUri?: string;
  /** Fallback initial(s) for the avatar disc when there is no image. */
  ownerInitials?: string;
}

/**
 * Font stacks for the band, concrete families first.
 *
 * The generic `sans-serif` is last, not first. Put it first and fontconfig
 * resolves the alias to whatever the host happens to have — which is a
 * different face with different metrics on every machine, while `fitToColumn`
 * below sizes every column against one fixed set of glyph advances. Naming
 * DejaVu first makes Elastic Beanstalk (.ebextensions/02_fonts.config), the
 * Docker image (font-dejavu) and local dev converge on the same face, so a
 * column that fits in a test fits in print.
 *
 * The generic still earns its place at the end: it is the difference between a
 * substituted face and no text at all.
 */
const SANS = `'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Segoe UI', Helvetica, Arial, sans-serif`;
const SERIF = `'DejaVu Serif', 'Liberation Serif', 'Noto Serif', Georgia, 'Times New Roman', serif`;

/** XML-escape — card names legitimately contain `&` (e.g. "Bill & Co"), which
 *  would otherwise produce malformed SVG and a blank text layer. */
const esc = (value: string): string =>
  value.replace(
    /[<>&'"]/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[c] ?? c,
  );

/** Very long card names would overflow the safe area; truncate rather than
 *  letting the text run under the trim line where it may be cut off. */
const fit = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max - 1)}…`;

/**
 * Grades print the way graders write them: "10", not "10.0"; "8.5" keeps its
 * half. The trailing ".0" reads as false precision on a printed slab, and it
 * costs two glyphs in the tightest column of the band.
 */
export const formatGrade = (grade: number): string =>
  Number.isInteger(grade) ? String(grade) : grade.toFixed(1);

/**
 * The band's corner radius.
 *
 * Shared, because it is drawn TWICE by two different renderers: the scrim in
 * `buildTextLayer` (SVG) and the alpha mask in `buildFrostedBand` (sharp). Both
 * carried their own `labelHeight * 0.09` until 2026-08-24, so changing the
 * radius in one place left the blurred backdrop poking square shoulders out
 * from behind the rounded scrim — visible only in a render, never in a test.
 */
export const bandRadius = (labelHeight: number): number =>
  Math.round(labelHeight * 0.12);

/**
 * The two horizontal lines the band's columns are built against.
 *
 * `top` is the one that matters, and it is shared by every column: client,
 * 2026-08-24, "the top of the logo, the grade section, and the QR code should
 * follow the same horizontal alignment." Before it, each run carried its own
 * fraction of the band height — 0.1 for the QR, 0.135 for the avatar, 0.45/0.55
 * for the grade — so the three column heads started on three different lines
 * and the band read as loose stacks rather than one strip.
 *
 * `bottom` is a FLOOR, not a second alignment: only the QR column reaches it
 * (see `stackRows`). Pulling every column down onto it was the first attempt at
 * this and the client rejected it in the same round — a column's rows caption
 * its head, and stretched to the floor they stop reading as belonging to it.
 *
 * Shared rather than inlined for the same reason `bandRadius` is: the top rail
 * is what makes the alignment a property of the BAND instead of a coincidence
 * between four independently-chosen fractions, and a column that opts out of it
 * re-creates exactly the bug this replaced.
 *
 * 2026-08-25: the rails moved in to 0.18 / 0.83 against the client's reference
 * band, which carries ~3.5 mm of clear air above and below its content. The
 * band was hanging its columns 2 mm from the top edge and running the card
 * information almost to the bottom one, so the strip read as full rather than
 * composed. Nothing about the alignment rule changed — only where the two lines
 * sit — and the room comes back out of the leading below, not out of type size.
 */
export const bandRails = (
  labelY: number,
  labelHeight: number,
): { top: number; bottom: number } => ({
  top: Math.round(labelY + labelHeight * 0.18),
  bottom: Math.round(labelY + labelHeight * 0.83),
});

/**
 * Leading below a column's HEAD — the avatar, the card name, the grade's word.
 *
 * Rows stack TIGHT under their head — the handle captions the avatar, the set
 * name captions the card name — rather than being spread down to the band's
 * floor (client, 2026-08-24, on the first pass at the rails: "between profile
 * image and @username decrease the gap as before", "below card name … remove
 * much space"). Distributing balanced as arithmetic and read as unrelated rows.
 *
 * ~2 mm on a 20 mm band, which is the leading the band carried before the rails
 * went in. The client asked for the alignment, not for the rhythm underneath it.
 */
export const bandRowLead = (labelHeight: number): number =>
  Math.round(labelHeight * 0.1);

/**
 * Leading between a column's CAPTION rows — the rows after the head.
 *
 * Under half `bandRowLead`, and the difference is the point. A column is a head
 * plus a caption block, not a list of equally-spaced lines: on the client's
 * reference band the step below "Electivire" is ~3× the step between "2023
 * Crown Zenith" and "Galarian Gallery", which are one wrapped set name and have
 * to read as one thing. Setting every row at the head lead — which is what this
 * band did until 2026-08-25 — gave a four-row card three identical gaps, so the
 * wrapped name broke into two unrelated lines and the column ran ~2.5 mm deeper
 * than the reference into the space the rails had just been moved to protect.
 */
export const bandCaptionLead = (labelHeight: number): number =>
  Math.round(labelHeight * 0.04);

/**
 * Cap height as a fraction of the font size.
 *
 * The band aligns runs by the TOP of their glyphs, but an SVG `y` is the
 * baseline — so every anchor has to be converted, and aligning the `y` values
 * of two runs at different sizes puts their tops at different heights, which is
 * the misalignment the rails exist to fix. 0.72 is the cap height shared by
 * DejaVu and Liberation, the faces SANS/SERIF below pin the band to; digits sit
 * on the cap line too, which is what the grade needs.
 */
export const CAP_RATIO = 0.72;

/** Baseline for a run whose glyph tops must sit at `capTop`. */
const baselineAt = (capTop: number, fontSize: number): number =>
  Math.round(capTop + fontSize * CAP_RATIO);

/**
 * Stacks a column's rows down from the top rail at a fixed leading.
 *
 * Rows are given as drawn HEIGHTS — cap height for a text run, pixel size for
 * the avatar — and come back as row TOPS. This is how every column is built
 * except the QR's; see `stackRows` for the one exception and why it is one.
 *
 * `lead` may be one number or one per gap. The array form exists for the
 * card-information column, whose head takes `bandRowLead` and whose caption
 * rows take the tighter `bandCaptionLead`; passing a single number for a column
 * that has both is how the wrapped set name ended up reading as two unrelated
 * lines. The lead at index i is the gap AFTER row i, so it is always one
 * shorter than `heights` in practice — a missing entry falls back to the last
 * one supplied rather than to zero, so a column that grows a row cannot
 * silently collapse it onto its neighbour.
 */
const tightRows = (
  top: number,
  lead: number | number[],
  heights: number[],
): number[] => {
  const leadAfter = (i: number): number =>
    typeof lead === "number" ? lead : (lead[i] ?? lead[lead.length - 1] ?? 0);

  let y = top;
  return heights.map((h, i) => {
    const rowTop = y;
    y += h + leadAfter(i);
    return rowTop;
  });
};

/**
 * Spreads a column's rows evenly between the two rails.
 *
 * Used for the QR column alone. Its head is the plate, which eats most of the
 * distance between the rails on its own, so there is no real slack to
 * distribute — spreading and stacking come out within a couple of pixels of
 * each other, and spreading is what lands the Pixel ID on the floor instead of
 * pushing it past the band's bottom edge. Every other column has slack, and
 * spreading those is precisely what the client rejected.
 */
const stackRows = (
  top: number,
  bottom: number,
  heights: number[],
): number[] => {
  const total = heights.reduce((sum, h) => sum + h, 0);
  // Clamped at zero: a column that cannot fit its rows stacks them flush
  // instead of spacing them negatively back up out of the band.
  const gap = Math.max(
    0,
    (bottom - top - total) / Math.max(1, heights.length - 1),
  );

  return tightRows(top, gap, heights);
};

/**
 * White margin around the QR so it still scans off the frosted band. It is the
 * plate's edge the eye reads as the code's top, so the PLATE is what the top
 * rail aligns — not the image inside it.
 *
 * Derived from the band height rather than fixed at 3 px: a QR's quiet zone is
 * a property of the code's own size, and the code is sized from the band. The
 * flat figure was ~0.25 mm, which is under the plate margin on the client's
 * reference band and thin enough that a scanner reads the band's edge as part
 * of the code.
 */
const qrPlateMargin = (labelHeight: number): number =>
  Math.max(3, Math.round(labelHeight * 0.026));

/**
 * Effective character count for width estimation, discounting narrow glyphs.
 *
 * `fitToColumn` below multiplies a character COUNT by an average advance, which
 * treats "8.5" as three full-width digits — the period is closer to half of one.
 * On the grade, the tightest column in the band, that pessimism cost ~15% of the
 * numeral's size for every half-grade: an 8.5 printed visibly smaller than a 10
 * beside it, for no reason a reader could see.
 *
 * Deliberately conservative — it only discounts glyphs that are unambiguously
 * narrow in every face the band can resolve to, and never widens an estimate.
 */
const NARROW = /[.,:;'!|Il1 ]/;
const weightedChars = (value: string): number =>
  [...value].reduce((sum, ch) => sum + (NARROW.test(ch) ? 0.45 : 1), 0);

/**
 * Label text as an SVG overlay sized to the full canvas, so it can be
 * composited at (0,0) without offset maths.
 *
 * The band is a four-column strip across the top of the slab, matching the
 * design the client approved on 2026-07-29:
 *
 *   [ PIXEL GRADE ][ card name / year / set / number ][ GRADE ][ ID + QR ]
 *
 * Everything is derived from the band rectangle rather than from the trim, so
 * a label stored with different `labelWMm`/`labelHMm` still lays out correctly.
 *
 * Columns tile horizontally and share two rails vertically — see `bandRails`.
 * Both are the same rule: a column's position is a property of the band, never
 * a fraction chosen for that column alone. Horizontal drift printed the grade
 * over the Pixel ID; vertical drift started the avatar, the grade and the QR on
 * three different lines, which is what the client's 2026-08-24 note is about.
 *
 * The panel behind the text is TWO layers, and this builder only draws the
 * second. `buildFrostedBand` blurs and dims the artwork itself in place, and
 * the scrim below sits on top of that to guarantee contrast. Splitting it is
 * what lets the band show the scene through it: a single opaque plate — which
 * is what this was until 2026-07-30 — reads as a black bar laid over a picture,
 * which is exactly the "separate or random background" the client rejected.
 *
 * The scrim cannot be dropped in favour of the blur alone. Blur redistributes
 * brightness, it does not bound it, so a sunlit backdrop stays bright after
 * blurring and would take white text with it. See BAND_SCRIM_OPACITY.
 */
/**
 * The band's four columns, tiled across it.
 *
 * Widths are explicit and sum to the band's inner width, and the row is laid
 * out from the RIGHT so the QR column anchors it and every other column falls
 * out of what is left. Positioning each column from its own fraction of the
 * band, as this did originally, let neighbours overlap: the wordmark ran into
 * the card name and the grade printed on top of the Pixel ID. Columns that tile
 * cannot collide.
 *
 * THREE columns of furniture, not four (client, UI Feedback v1 edit #4):
 *
 *   [ owner avatar + handle ][ card info ][ GRADE ][ QR over PIXEL ID ]
 *
 * The Pixel ID used to own a column of its own; stacking it under the QR is
 * what frees the width that (a) puts the grade next to the QR and (b) widens
 * the card-information column, which were both asked for in the same note.
 *
 * Exported because `slabComposite.test.ts` needs these coordinates to assert
 * that runs stay in their columns, and it used to re-derive them from copied
 * fractions. That copy silently drifted every time a width moved — a test
 * measuring the old columns still passes, it just stops measuring the band that
 * is actually drawn, which is the one failure this suite exists to prevent.
 */
export const bandColumns = (labelX: number, labelWidth: number) => {
  const padX = Math.round(labelWidth * 0.035);
  const gap = Math.round(padX * 0.6);
  const inner = labelWidth - padX * 2;

  // The QR column holds the code AND the id beneath it, so it is sized by
  // whichever of the two is wider — the id is the longer of the pair at typical
  // sizes, and a column cut to the QR alone would clip it.
  const qrColW = Math.round(inner * 0.17);
  const qrColRight = labelX + labelWidth - padX;
  const qrColLeft = qrColRight - qrColW;

  // 0.235, up from 0.14 → 0.21 → here (2026-08-24, then 2026-08-25, both
  // against the client's reference band). The grade is the largest glyph on the
  // slab and the column was originally sized as if it were furniture: at 0.14 a
  // three-character grade like "8.5" was capped to ~58% of the size the design
  // asks for, so half-grades printed noticeably smaller than whole ones.
  //
  // The last step is not about the numeral, which no longer binds — it is about
  // the Pixel Verified badge, the widest run in this column and the one nearest
  // the reference's limit. The width comes from the card-info column, which
  // keeps its long-name floor: `slabComposite.test.ts` pins that at 32 px and
  // it is what bounds how much more the grade can ever take. At 0.235 the floor
  // lands at 33, so this is very nearly the end of that road.
  const gradeW = Math.round(inner * 0.235);
  const gradeRight = qrColLeft - gap;
  const gradeLeft = gradeRight - gradeW;

  // The owner's identity replaces the PIXEL GRADE wordmark.
  //
  // 0.145, down from 0.17 (2026-08-25). This column holds a disc and a handle
  // and nothing else, and at 0.17 it reserved ~2.5 mm of dead air either side of
  // the avatar — which pushed the whole band right of the reference and put the
  // first rule 2 mm off. The width it gives up goes to the card name. What it
  // costs is the handle's cap: a long one now sets a step smaller, which is the
  // right trade in a column whose head is an image.
  const ownerX = labelX + padX;
  const ownerW = Math.round(inner * 0.145);

  const infoX = ownerX + ownerW + gap;

  return {
    padX,
    gap,
    inner,
    ownerX,
    ownerW,
    ownerCentre: ownerX + ownerW / 2,
    infoX,
    infoW: gradeLeft - gap - infoX,
    gradeLeft,
    gradeW,
    gradeCentre: gradeLeft + gradeW / 2,
    qrColLeft,
    qrColW,
    qrColCentre: qrColLeft + qrColW / 2,
  };
};

export const buildTextLayer = (layout: SlabLayout, text: LabelText): Buffer => {
  const { labelX, labelY, labelWidth, labelHeight } = layout;

  // ---- Rows ----
  //
  // Two horizontal lines, shared by every column: the heads of the columns hang
  // from `rails.top` and their last row sits on `rails.bottom`. See `bandRails`.
  const rails = bandRails(labelY, labelHeight);

  // ---- Columns ----
  const {
    gap,
    ownerW,
    ownerCentre,
    infoX,
    infoW,
    gradeLeft,
    gradeW,
    gradeCentre,
    qrColLeft,
    qrColW,
    qrColCentre,
  } = bandColumns(labelX, labelWidth);

  // 0.40 of the band, down from 0.52 (2026-08-25, against the client's
  // reference band). At 300 DPI that is ~8 mm square, which still scans
  // reliably for a short URL — the encoded string is a fixed-length verify
  // path, so its module count does not grow with the data. Going much below
  // this does risk a code that will not read off a printed slab.
  //
  // The plate's margin comes off the column width, not out of it: the plate is
  // what is drawn, so sizing the code to the full column pushed white over the
  // column's right edge.
  const qrPlate = qrPlateMargin(labelHeight);
  const qrSize = Math.min(Math.round(labelHeight * 0.4), qrColW - qrPlate * 2);
  const qrX = Math.round(qrColCentre - qrSize / 2);

  // ---- Type ----
  //
  // Sized from band HEIGHT (20 mm is the binding constraint), then capped by
  // the width of the column it sits in. The cap is what keeps a three-glyph
  // grade like "8.5" or a long Pixel ID from spilling into its neighbour —
  // 0.58em is a safe average advance for the faces used here.
  // `tracking` matters more than it looks: letter-spacing is added per glyph
  // and is not part of the font size, so a tracked run of five capitals can be
  // 20% wider than its size alone predicts. Leaving it out is what pushed the
  // PIXEL GRADE wordmark over its column and into the card name.
  //
  // `advance` is the average glyph width as a fraction of the font size, and it
  // is NOT one number for the whole band: bold uppercase runs about 0.78em
  // while mixed-case body text is nearer 0.55em. Using a single optimistic
  // value is what let the wordmark keep overflowing even after tracking was
  // accounted for.
  const fitToColumn = (
    preferred: number,
    columnW: number,
    chars: number,
    {
      tracking = 0,
      advance = 0.58,
    }: { tracking?: number; advance?: number } = {},
  ) =>
    Math.max(
      8,
      Math.min(
        preferred,
        Math.floor(
          (columnW - Math.max(0, chars - 1) * tracking) / (chars * advance),
        ),
      ),
    );

  /** Bold uppercase — the widest case the band uses. */
  const CAPS_ADVANCE = 0.78;
  /** Bold mixed-case, e.g. the owner handle. Between body (0.55) and caps. */
  const BOLD_ADVANCE = 0.62;

  const gradeText = formatGrade(text.grade);
  const gradeLabelText = text.gradeLabel.toUpperCase();

  // The card name shrinks to fit before it truncates. Truncating at a fixed
  // size turned "Charizard ex" into "Chariza…" while there was still room to
  // set it a few points smaller — and the name is the one thing on the band a
  // collector actually reads. Past MAX_NAME_CHARS it stops shrinking and
  // truncates instead, so a pathological name cannot reduce the band to
  // unreadable type.
  const MAX_NAME_CHARS = 16;
  const nameSize = fitToColumn(
    Math.round(labelHeight * 0.2),
    infoW,
    Math.min(text.cardName.length, MAX_NAME_CHARS),
    { advance: 0.55 },
  );
  const metaSize = Math.round(labelHeight * 0.115);
  const microSize = Math.round(labelHeight * 0.1);
  // 0.36, down from 0.42 (2026-08-25). At 0.42 the numeral filled its column
  // edge to edge and read as the only thing on the band; the reference sets it
  // large but with air either side. The word below it moved the other way — see
  // `gradeLabelSize`.
  const gradeSize = fitToColumn(
    Math.round(labelHeight * 0.36),
    gradeW,
    weightedChars(gradeText),
    { advance: 0.62 },
  );
  // 0.15 of the band, NOT `microSize`. The word is half of the grade, not a
  // caption on it: at 0.1 it printed at the same size as the card number three
  // columns away, which is what made "NM-MT" read as furniture rather than as
  // the plain-language grade. It is still capped to the grade column, so a
  // six-character label like "GEM-MT" shrinks rather than overflowing.
  const gradeLabelSize = fitToColumn(
    Math.round(labelHeight * 0.15),
    gradeW,
    weightedChars(gradeLabelText),
    {
      tracking: 2,
      advance: CAPS_ADVANCE,
    },
  );
  // ---- Owner identity ----
  //
  // The avatar is a disc sized from the band height, with the handle beneath.
  // Both are centred in the column so a short handle does not read as
  // left-aligned against a centred disc.
  const avatarSize = Math.min(Math.round(labelHeight * 0.38), ownerW);
  const avatarX = Math.round(ownerCentre - avatarSize / 2);
  // The disc hangs from the top rail, exactly like the grade's cap line and the
  // QR's plate. It used to sit at 0.135 against the QR's 0.1 — a 1 mm step that
  // is small in a fraction and obvious across a 20 mm band.
  const avatarY = rails.top;
  const avatarRadius = Math.round(avatarSize / 2);

  const handleText = text.ownerUsername ? `@${text.ownerUsername}` : "";
  // Handles run to 24 characters, which at full size would be a third of the
  // band wide — this is the column where shrinking matters most.
  //
  // ⚠️ The handle is drawn BOLD (see the `.handle` class), so it must be sized
  // with BOLD_ADVANCE. It was using the 0.55 body-text figure, which is the
  // exact per-face mistake this file's header warns about: "@pokeomar25" was
  // sized to 21 px, drew ~143 px into a 131 px column, and overhung the divider
  // into the card-name column. Silent, and only visible once printed.
  const handleSize = handleText
    ? fitToColumn(Math.round(labelHeight * 0.09), ownerW, handleText.length, {
        advance: BOLD_ADVANCE,
      })
    : 0;
  const handleChars = handleSize
    ? Math.max(4, Math.floor(ownerW / (handleSize * BOLD_ADVANCE)))
    : 0;

  const initialsSize = Math.round(avatarSize * 0.42);

  // The id sits under the QR now, so it is bounded by the QR column rather than
  // by a column of its own.
  //
  // The CAPTION is the larger, brighter of the pair and the VALUE sits under it
  // smaller and muted — which is the opposite of how this was set until
  // 2026-08-25, and the reference band is unambiguous about it. The reasoning
  // is the same one that captions the QR at all: "PIXEL ID" is what a person
  // reads to know what the string is, and the string itself is a machine
  // identifier nobody transcribes by eye when the code above it resolves the
  // same page. Setting the value at full weight made the band's densest column
  // compete with the grade.
  const idCaptionSize = fitToColumn(microSize, qrColW, "PIXEL ID".length, {
    tracking: 1,
    advance: CAPS_ADVANCE,
  });
  // ⚠️ 0.65, not the 0.58 default. A Pixel ID is uppercase letters and digits
  // ("PG-859F13E701"), which rasterise at 0.55em bare — above the 0.58 default
  // once its 1 px tracking is added, so the default was UNDER-estimating the
  // one run in the band it was applied to. It happened to fit at 13 characters
  // and would have overflowed the column silently had the id format ever grown,
  // which is the only kind of bug this file has ever had. 0.58 is a mixed-case
  // body figure and this run has no lowercase in it.
  const idSize = fitToColumn(
    Math.round(idCaptionSize * 0.88),
    qrColW,
    text.pixelId.length,
    { tracking: 1, advance: 0.65 },
  );

  // ---- Pixel Verified badge ----
  //
  // ⚠️ This was sized against `infoW` — the card-information column — while
  // being DRAWN centred in the grade column, which is less than half as wide.
  // The run therefore printed ~70% wider than the space it sits in: it reached
  // back under the set name on one side and straight through the Pixel ID on
  // the other, on every verified slab. It is the exact per-column mistake this
  // file's header warns about, and it is invisible until something is printed.
  //
  // The badge is now measured against its OWN column, icon included, and the
  // shield is sized from the type rather than fixed so the two scale together.
  const verifiedText = "PIXEL VERIFIED";
  const shieldSize = Math.round(labelHeight * 0.096);
  const shieldGap = Math.round(shieldSize * 0.35);
  // `CAPS_ADVANCE` (0.78) is the band's safe figure for an ARBITRARY bold-caps
  // run, and it is deliberately pessimistic. This run is not arbitrary — it is
  // one fixed literal. Rasterised in DejaVu Sans Bold it measures 7.11em of ink
  // for the whole string, which is 0.60em per unit of `weightedChars` once the
  // three I's and the space are discounted. Carrying the generic figure here
  // cost the badge ~20% of its size for width it can never need, in the column
  // where the type is already smallest. 0.70 holds a ~16% margin over the
  // measurement without pretending the run is body text.
  //
  // ⚠️ This licence is specific to a CONSTANT string. Any run whose content
  // varies must keep CAPS_ADVANCE — measuring a fixed sample and applying it to
  // variable text is how a column overflows silently.
  const VERIFIED_ADVANCE = 0.7;
  const verifiedSize = fitToColumn(
    Math.round(labelHeight * 0.085),
    gradeW - shieldSize - shieldGap,
    weightedChars(verifiedText),
    { advance: VERIFIED_ADVANCE },
  );
  // Laid out as one unit — icon, gap, text — then centred as a unit on the
  // grade column, so the shield cannot drift away from the words it qualifies.
  const verifiedTextW =
    weightedChars(verifiedText) * verifiedSize * VERIFIED_ADVANCE;
  const badgeW = shieldSize + shieldGap + verifiedTextW;
  const badgeLeft = gradeCentre - badgeW / 2;

  const radius = bandRadius(labelHeight);

  // Character budget for the free-text column, from its pixel width.
  const nameChars = Math.min(
    MAX_NAME_CHARS,
    Math.max(6, Math.floor(infoW / (nameSize * 0.55))),
  );
  const metaChars = Math.max(6, Math.floor(infoW / (metaSize * 0.55)));

  const rawSetLine = [text.year, text.setExpansion].filter(Boolean).join(" ");
  let setLine1 = rawSetLine;
  let setLine2 = "";
  if (rawSetLine.length > metaChars && rawSetLine.includes(" ")) {
    const splitIdx = rawSetLine.lastIndexOf(" ", metaChars);
    const safeSplit = splitIdx > 0 ? splitIdx : rawSetLine.indexOf(" ");
    if (safeSplit > 0) {
      setLine1 = rawSetLine.slice(0, safeSplit);
      setLine2 = rawSetLine.slice(safeSplit + 1);
    }
  }

  // Single spaces around the bullet. The separator was "  ·  " — five
  // characters of the column's budget spent on punctuation, which is what
  // truncated "English" to "Engl…" once the card-info column narrowed.
  const numberLine = [text.cardNumber, text.language].filter(Boolean).join(" • ");
  // Set one step down from the set lines and given its own budget: it is
  // reference data, not a name, and it is the longest line in the column.
  const numberSize = Math.round(metaSize * 0.92);
  const numberChars = Math.max(6, Math.floor(infoW / (numberSize * 0.55)));

  // ---- Vertical placement ----
  //
  // Every column head sits on the top rail and its rows stack tight beneath it,
  // so the band has a single top line and one rhythm rather than a dozen
  // hand-picked fractions of the height. Rows are measured by CAP HEIGHT, not
  // font size: the tops are what the client is aligning, and two runs at
  // different sizes sharing a baseline do not share a top.
  //
  // TWO leads, not one: `rowLead` steps down from a column's head, `capLead`
  // holds its caption rows together beneath it. See `bandCaptionLead`.
  const rowLead = bandRowLead(labelHeight);
  const capLead = bandCaptionLead(labelHeight);

  // Identity: the handle captions the disc, so it hangs under it at the tight
  // CAPTION lead, not the head lead the card name gets.
  //
  // This column's head is an IMAGE, and that is the whole reason it differs.
  // A text head is measured by its cap height but drawn with sidebearings and
  // a descender well beneath it, so `rowLead` below a word already looks
  // tighter than it measures. A disc has none of that — its drawn edge IS its
  // measured edge — so the same number buys visibly more air, and the handle
  // floated away from the avatar it belongs to. Client, 2026-08-25: "on the
  // username space the gap is too much, need minimal space."
  const [, handleTop] = tightRows(rails.top, capLead, [
    avatarSize,
    handleSize * CAP_RATIO,
  ]);

  // Card information: as many rows as the card actually has, with the same
  // leads whether the set name wraps to a second line or not. The old fixed
  // fractions carried a separate y for each case and had to be re-tuned by hand
  // every time a row was added.
  //
  // The card NAME is this column's head, so the step below it is `rowLead` and
  // everything after it is a caption block at `capLead`. That is what makes a
  // wrapped set name read as one name.
  const infoLines = [
    { cls: "name", size: nameSize, value: fit(text.cardName, nameChars) },
    ...(setLine1
      ? [{ cls: "meta", size: metaSize, value: fit(setLine1, metaChars) }]
      : []),
    ...(setLine2
      ? [{ cls: "meta", size: metaSize, value: fit(setLine2, metaChars) }]
      : []),
    ...(numberLine
      ? [{ cls: "micro", size: numberSize, value: fit(numberLine, numberChars) }]
      : []),
  ];
  const infoBaselines = tightRows(
    rails.top,
    [rowLead, capLead],
    infoLines.map((line) => line.size * CAP_RATIO),
  ).map((top, i) => baselineAt(top, infoLines[i].size));

  // Grade: the word is set close under the numeral, on purpose.
  //
  // It does not merely follow the numeral, it names it (client, 2026-08-24:
  // "move up the NM info more higher up"). At a full `rowLead` it floated clear
  // of the grade and read as an unrelated caption.
  //
  // 0.075, up from 0.035 (2026-08-25, against the reference band). The word
  // also nearly doubled in size in the same change, and 0.035 was tuned for a
  // run half this tall — kept there, the two would have collided into a single
  // block rather than reading as a numeral and its name. The pairing is what
  // matters, not the figure: this is still well under `rowLead`.
  const gradeLead = Math.round(labelHeight * 0.075);
  const gradeBaseline = baselineAt(rails.top, gradeSize);
  const gradeLabelBaseline =
    gradeBaseline + gradeLead + Math.round(gradeLabelSize * CAP_RATIO);
  // The badge below is a stamp rather than part of that reading, so it takes
  // the ordinary lead — and it is measured by the ICON, the tallest thing in
  // the run, or the icon would hang above the gap the type was given. Its text
  // is then centred on the icon rather than sharing its top, because a 23 px
  // disc and a 15 px word aligned at the cap read as the word having slipped.
  const badgeTop = gradeLabelBaseline + rowLead;
  const badgeBaseline = Math.round(
    badgeTop + shieldSize / 2 + (verifiedSize * CAP_RATIO) / 2,
  );

  // QR: the plate on the top rail, the id on the bottom one, caption between.
  // The QR's row is the PLATE's height — the white margin is what is drawn, and
  // aligning the image inside it would leave the visible edge proud of the
  // avatar and the grade.
  const [qrPlateTop, qrCaptionTop, pixelIdTop] = stackRows(
    rails.top,
    rails.bottom,
    [
      qrSize + qrPlate * 2,
      idCaptionSize * CAP_RATIO,
      idSize * CAP_RATIO,
    ],
  );
  // Reserved whether or not the code rendered: `qrDataUri` is optional only as
  // a failure fallback, and a caption that jumped up the band when QR
  // generation failed would print a differently-laid-out slab for the same card.
  const qrY = Math.round(qrPlateTop + qrPlate);

  // The three column rules, drawn to ONE depth.
  //
  // Restored to three on 2026-08-25: the band carried a single rule before the
  // grade, and the client's reference separates all four columns. The note this
  // reverses ("a second rule there boxed the avatar in") was written against a
  // much lighter band, where a 0.22-white line was the strongest thing on the
  // strip; against the darkened panel the rules sit back and do the job they
  // were meant to.
  //
  // They end where the band's CONTENT ends, not at the band's floor — the floor
  // belongs to the QR column, the only one that reaches it, and a rule taken
  // down to it leaves a stub hanging below every column it brackets. One depth
  // for all three, because three rules of three different lengths is the ragged
  // strip the rails were introduced to fix, turned ninety degrees.
  const dividerBottom = Math.round(
    Math.max(
      infoBaselines[infoBaselines.length - 1],
      gradeLabelBaseline,
    ) +
      rowLead * 0.4,
  );
  const dividerXs = [
    infoX - gap / 2,
    gradeLeft - gap / 2,
    qrColLeft - gap / 2,
  ];

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .handle { font-family: ${SANS}; font-weight: 800; fill: #FFFFFF; }
    .initials { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    .name   { font-family: ${SERIF}; font-weight: 700; fill: #FFFFFF; }
    .meta   { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    .micro  { font-family: ${SANS}; font-weight: 800; fill: #FFFFFF; letter-spacing: 1px; }
    .grade  { font-family: ${SANS}; font-weight: 800; fill: #FFFFFF; }
    .glabel { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; letter-spacing: 2px; }
    /* No letter-spacing: this is the longest run in the narrowest column, and
       tracking 14 capitals is what pushed it out of the column in the first
       place. Every pixel it buys back goes into the type size instead. */
    .verified { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    /* The Pixel ID VALUE, muted against its white caption — see \`idSize\`.
       Still ~7:1 on the darkened band, so this is hierarchy, not a legibility
       trade: the string has to stay readable to anyone typing it into /verify
       by hand when they cannot scan the code above it. */
    .idvalue { font-family: ${SANS}; font-weight: 800; fill: #FFFFFF; }
  </style>

  <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
        rx="${radius}" ry="${radius}" fill="#0B0B0C" fill-opacity="${BAND_SCRIM_OPACITY}" />

  <!-- The lit edge of the glass. Without it the frosted panel has no boundary
       and bleeds into the artwork instead of sitting in front of it.

       Softened to 0.14 on 2026-08-25 with the band itself: against a near-black
       panel a 0.28-white rim is a bright outline, and the reference band reads
       as an unlit slab of glass. The boundary is now carried mostly by the
       contrast between panel and artwork, which is exactly what darkening it
       bought. -->
  <rect x="${labelX + 1}" y="${labelY + 1}" width="${labelWidth - 2}" height="${labelHeight - 2}"
        rx="${radius}" ry="${radius}"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.14" stroke-width="2" />

  <!-- Owner identity: avatar disc over the handle. Replaced the PIXEL GRADE
       wordmark on 2026-07-30 at the client's direction. The image is clipped to
       a circle rather than masked, so a square avatar cannot print as a square. -->
  <defs>
    <clipPath id="pg-avatar-clip">
      <circle cx="${avatarX + avatarRadius}" cy="${avatarY + avatarRadius}" r="${avatarRadius}" />
    </clipPath>
  </defs>
  ${
    text.ownerAvatarDataUri
      ? `<image x="${avatarX}" y="${avatarY}" width="${avatarSize}" height="${avatarSize}"
              preserveAspectRatio="xMidYMid slice" clip-path="url(#pg-avatar-clip)"
              href="${text.ownerAvatarDataUri}" />`
      : `<circle cx="${avatarX + avatarRadius}" cy="${avatarY + avatarRadius}" r="${avatarRadius}" fill="#6D4AFF" />
         <text x="${avatarX + avatarRadius}" y="${avatarY + avatarRadius + initialsSize * 0.36}" class="initials" font-size="${initialsSize}" text-anchor="middle">${esc(text.ownerInitials ?? "")}</text>`
  }
  <!-- A faint ring, kept even though the reference band shows none. The
       reference's avatar is a bright mark on a dark disc and finds its own
       edge; a real user's photo can be black, and on a near-black band an
       unringed dark avatar dissolves into the panel with the handle floating
       under nothing. 0.15 is low enough not to read as a border. -->
  <circle cx="${avatarX + avatarRadius}" cy="${avatarY + avatarRadius}" r="${avatarRadius}"
          fill="none" stroke="#FFFFFF" stroke-opacity="0.15" stroke-width="2" />
  ${
    handleText
      ? `<text x="${ownerCentre}" y="${baselineAt(handleTop, handleSize)}" class="handle" font-size="${handleSize}" text-anchor="middle">${esc(fit(handleText, handleChars))}</text>`
      : ""
  }

  ${infoLines
    .map(
      (line, i) =>
        `<text x="${infoX}" y="${infoBaselines[i]}" class="${line.cls}" font-size="${line.size}">${esc(line.value)}</text>`,
    )
    .join("\n  ")}

  <!-- One rule per column boundary, all to the same depth. See \`dividerXs\`. -->
  ${dividerXs
    .map(
      (x) =>
        `<line x1="${x}" y1="${rails.top}" x2="${x}" y2="${dividerBottom}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />`,
    )
    .join("\n  ")}

  <text x="${gradeCentre}" y="${gradeBaseline}" class="grade" font-size="${gradeSize}" text-anchor="middle">${esc(gradeText)}</text>
  <text x="${gradeCentre}" y="${gradeLabelBaseline}" class="glabel" font-size="${gradeLabelSize}" text-anchor="middle">${esc(gradeLabelText)}</text>
  <!-- A filled disc with a check, not a shield (2026-08-25, matching the
       client's reference band). At 2 mm the shield's silhouette was mush — the
       point of a mark this small is that it is recognisable at a glance, and a
       circle survives the size where a shield does not. The purple is
       unchanged. -->
  ${
    text.pixelVerified
      ? `<g transform="translate(${badgeLeft} ${badgeTop}) scale(${shieldSize / 24})">
           <circle cx="12" cy="12" r="11" fill="#8B5CF6" />
           <path d="M6.9 12.3 L10.4 15.8 L17.1 8.6" fill="none" stroke="#FFFFFF"
                 stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
         </g>
         <text x="${badgeLeft + shieldSize + shieldGap}" y="${badgeBaseline}" class="verified" font-size="${verifiedSize}">${esc(verifiedText)}</text>`
      : ""
  }

  <!-- QR over the Pixel ID (client, UI Feedback v1 edit #4 — the id used to sit
       in its own column to the left of the code). Both are centred on the
       column so the caption, the value and the code share one axis.

       The QR keeps a white plate behind it: the band is frosted now, and a code
       read against whatever artwork happens to be underneath will not scan. -->
  ${
    text.qrDataUri
      ? `<rect x="${qrX - qrPlate}" y="${qrY - qrPlate}" width="${qrSize + qrPlate * 2}" height="${qrSize + qrPlate * 2}" rx="4" ry="4" fill="#FFFFFF" />
         <image x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" href="${text.qrDataUri}" />`
      : ""
  }
  <text x="${qrColCentre}" y="${baselineAt(qrCaptionTop, idCaptionSize)}" class="micro" font-size="${idCaptionSize}" text-anchor="middle">PIXEL ID</text>
  <text x="${qrColCentre}" y="${baselineAt(pixelIdTop, idSize)}" class="idvalue" font-size="${idSize}" text-anchor="middle">${esc(text.pixelId)}</text>
</svg>`;

  return Buffer.from(svg);
};

/**
 * The transparent slab case — the clear plastic holder the card sits inside.
 *
 * Requested by the client on 2026-07-30: the preview must show "the Pokémon
 * card, generated extended artwork, PixelGrade label, and transparent slab".
 * Without it the output reads as a printed poster rather than a slabbed card,
 * which was the biggest visual gap against their approved mockup.
 *
 * Drawn in code, like the label band, so a bad generation can never distort or
 * cover it. Every dimension is derived from the trim rectangle, so a label
 * stored at different millimetres still gets a correctly-proportioned case.
 *
 * The rim is kept narrower than the safe margin on purpose: the label band is
 * inset 5 mm from the trim on an 80 mm slab, so a rim at ~3% of the width
 * cannot creep over the band or the card window.
 */
export const buildCaseLayer = (layout: SlabLayout): Buffer => {
  const { trimX, trimY, trimWidth, trimHeight } = layout;

  const radius = Math.round(trimWidth * 0.045);
  /** The frosted plastic edge, as seen face-on. */
  const rim = Math.round(trimWidth * 0.03);
  const innerRadius = Math.max(2, radius - rim);
  /** Hairlines that sell the plastic's thickness. */
  const edge = Math.max(2, Math.round(trimWidth * 0.0035));

  // The moulded tabs on the left and right sides of a side-opening holder.
  const notchWidth = Math.max(4, Math.round(trimWidth * 0.011));
  const notchHeight = Math.round(trimHeight * 0.08);
  const notchRadius = Math.round(notchWidth / 2);
  const notchY = Math.round(trimY + (trimHeight - notchHeight) / 2);

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Bright where light catches the bevel, near-invisible across the flats.
         A uniform band would read as a painted border, not as plastic. -->
    <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.45" />
      <stop offset="26%"  stop-color="#FFFFFF" stop-opacity="0.10" />
      <stop offset="52%"  stop-color="#FFFFFF" stop-opacity="0.05" />
      <stop offset="76%"  stop-color="#FFFFFF" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.40" />
    </linearGradient>
    <!-- One specular sweep across the face, fading out before it reaches the
         card window so it never washes out the artwork underneath. -->
    <linearGradient id="gloss" x1="0%" y1="0%" x2="72%" y2="100%">
      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0.13" />
      <stop offset="16%"  stop-color="#FFFFFF" stop-opacity="0.035" />
      <stop offset="38%"  stop-color="#FFFFFF" stop-opacity="0" />
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0" />
    </linearGradient>
  </defs>

  <rect x="${trimX}" y="${trimY}" width="${trimWidth}" height="${trimHeight}"
        rx="${radius}" ry="${radius}" fill="url(#gloss)" />

  <rect x="${trimX + rim / 2}" y="${trimY + rim / 2}"
        width="${trimWidth - rim}" height="${trimHeight - rim}"
        rx="${radius}" ry="${radius}"
        fill="none" stroke="url(#rim)" stroke-width="${rim}" />

  <!-- Crisp outer boundary. -->
  <rect x="${trimX + edge}" y="${trimY + edge}"
        width="${trimWidth - edge * 2}" height="${trimHeight - edge * 2}"
        rx="${radius}" ry="${radius}"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="${edge}" />

  <!-- Inner lip: a dark line with a lighter one just inside it reads as the
       shelf where the plastic steps down to the card. -->
  <rect x="${trimX + rim}" y="${trimY + rim}"
        width="${trimWidth - rim * 2}" height="${trimHeight - rim * 2}"
        rx="${innerRadius}" ry="${innerRadius}"
        fill="none" stroke="#000000" stroke-opacity="0.3" stroke-width="${edge}" />
  <rect x="${trimX + rim + edge}" y="${trimY + rim + edge}"
        width="${trimWidth - (rim + edge) * 2}" height="${trimHeight - (rim + edge) * 2}"
        rx="${innerRadius}" ry="${innerRadius}"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.24" stroke-width="${edge}" />

  <rect x="${trimX}" y="${notchY}" width="${notchWidth}" height="${notchHeight}"
        rx="${notchRadius}" ry="${notchRadius}" fill="#FFFFFF" fill-opacity="0.5" />
  <rect x="${trimX + trimWidth - notchWidth}" y="${notchY}"
        width="${notchWidth}" height="${notchHeight}"
        rx="${notchRadius}" ry="${notchRadius}" fill="#FFFFFF" fill-opacity="0.5" />
</svg>`;

  return Buffer.from(svg);
};

/**
 * The frosted glass behind the label band.
 *
 * Takes the region of the finished background that the band will cover, blurs
 * it, dims it, and hands it back to be composited straight back where it came
 * from. The band therefore shows the artwork's own colour and light rather than
 * a fixed dark plate — which is the whole of the client's 2026-07-30 note that
 * the art should "look like a natural continuation of the card" instead of a
 * separate background.
 *
 * It has to happen here rather than in the SVG because an overlay cannot sample
 * what is underneath it. SVG has no backdrop filter, so the only way to blur
 * the *backdrop* is to cut it out, blur the pixels, and put them back.
 *
 * `background` must already be resized to the canvas: the extract window comes
 * from layout coordinates and would be out of bounds on the raw generated image.
 */
export const buildFrostedBand = async (
  background: Buffer,
  layout: SlabLayout,
): Promise<Buffer> => {
  const { labelX, labelY, labelWidth, labelHeight } = layout;
  const radius = bandRadius(labelHeight);

  const frosted = await sharp(background)
    .extract({
      left: labelX,
      top: labelY,
      width: labelWidth,
      height: labelHeight,
    })
    .blur(BAND_FROST_BLUR_SIGMA)
    // Bounds the brightness the scrim then has to work against. Blur alone
    // leaves a bright backdrop bright; see BAND_FROST_BRIGHTNESS.
    .modulate({ brightness: BAND_FROST_BRIGHTNESS })
    .toBuffer();

  // Match the band's rounded corners, or the blurred rectangle prints as square
  // shoulders poking out from behind the scrim's radius.
  const corners = Buffer.from(
    `<svg width="${labelWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${labelWidth}" height="${labelHeight}" rx="${radius}" ry="${radius}" fill="#FFFFFF" />` +
      `</svg>`,
  );

  return sharp(frosted)
    .composite([{ input: corners, blend: "dest-in" }])
    .png()
    .toBuffer();
};

/** Bleed and trim guides, for the preview toggle. Never part of an export. */
export const buildGuideLayer = (layout: SlabLayout): Buffer => {
  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="${layout.trimX}" y="${layout.trimY}" width="${layout.trimWidth}" height="${layout.trimHeight}"
        fill="none" stroke="#FF3B30" stroke-width="4" stroke-dasharray="18 12" />
  <rect x="${layout.safeX}" y="${layout.safeY}" width="${layout.safeWidth}" height="${layout.safeHeight}"
        fill="none" stroke="#34C759" stroke-width="3" stroke-dasharray="10 10" />
  <rect x="${layout.openingX}" y="${layout.openingY}" width="${layout.openingWidth}" height="${layout.openingHeight}"
        fill="none" stroke="#0A84FF" stroke-width="4" />
  <rect x="${layout.labelX}" y="${layout.labelY}" width="${layout.labelWidth}" height="${layout.labelHeight}"
        fill="none" stroke="#FF9F0A" stroke-width="4" stroke-dasharray="12 8" />
</svg>`;
  return Buffer.from(svg);
};

/**
 * Builds the finished PNG: background → frosted band → card image in the fixed
 * window → label text → slab case → optional guides.
 *
 * Layer order matters. The case goes ABOVE the card and the label because it
 * is the plastic in front of them; below it, the gloss and rim would be
 * overpainted and the whole thing would flatten out.
 *
 * The card is fitted with `contain`, not `cover`. A card whose aspect ratio
 * differs slightly from the 65×90 window must be letterboxed, never cropped —
 * cropping would cut the card's own edges, which are exactly what the grade is
 * about.
 *
 * `showCase` defaults ON, matching the design the client approved. Pass false
 * for a print insert that will go inside a REAL holder — drawing a plastic
 * case onto artwork that then sits inside plastic would double it up.
 */
export const compositePng = async (
  layout: SlabLayout,
  backgroundBuffer: Buffer,
  cardBuffer: Buffer,
  text: LabelText,
  options: { showGuides?: boolean; showCase?: boolean; excludeCardImage?: boolean } = {},
): Promise<Buffer> => {
  const background = await sharp(backgroundBuffer)
    .resize(layout.canvasWidth, layout.canvasHeight, { fit: "cover" })
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [
    // Frosted glass first: it is derived from the background and goes straight
    // back on top of it, underneath everything the band then prints.
    {
      input: await buildFrostedBand(background, layout),
      left: layout.labelX,
      top: layout.labelY,
    },
  ];

  if (options.excludeCardImage) {
    // Punch a 100% transparent opening hole through the background artwork
    // so the back of the physical card remains visible through transparent slab.
    const hole = await sharp({
      create: {
        width: layout.openingWidth,
        height: layout.openingHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 255 },
      },
    })
      .png()
      .toBuffer();

    layers.push({
      input: hole,
      left: layout.openingX,
      top: layout.openingY,
      blend: "dest-out",
    });
  } else {
    const card = await sharp(cardBuffer)
      .rotate()
      .resize(layout.openingWidth, layout.openingHeight, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    layers.push({ input: card, left: layout.openingX, top: layout.openingY });
  }

  layers.push({ input: buildTextLayer(layout, text), left: 0, top: 0 });

  if (options.showCase !== false) {
    layers.push({ input: buildCaseLayer(layout), left: 0, top: 0 });
  }

  // Guides last: they are a measuring tool and must sit on top of everything,
  // including the case.
  if (options.showGuides) {
    layers.push({ input: buildGuideLayer(layout), left: 0, top: 0 });
  }

  return sharp(background)
    .composite(layers)
    .png()
    // Embeds the DPI in the file metadata so a print shop opening the PNG sees
    // 300 DPI rather than assuming 72 and scaling the slab wrong.
    .withMetadata({ density: SLAB_EXPORT_DPI })
    .toBuffer();
};

/**
 * Builds high-resolution (300 DPI) label-only PNG for physical sticker/insert printing.
 */
export const buildLabelOnlyPng = async (
  layout: SlabLayout,
  text: LabelText,
): Promise<Buffer> => {
  const textSvg = buildTextLayer(layout, text);
  const blackBg = await sharp({
    create: {
      width: layout.labelWidth,
      height: layout.labelHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const labelLayer = await sharp(textSvg)
    .extract({
      left: layout.labelX,
      top: layout.labelY,
      width: layout.labelWidth,
      height: layout.labelHeight,
    })
    .toBuffer();

  return sharp(blackBg)
    .composite([{ input: labelLayer }])
    .png()
    .withMetadata({ density: SLAB_EXPORT_DPI })
    .toBuffer();
};

/**
 * Wraps the PNG in a PDF at exact physical dimensions.
 *
 * PDF points are 1/72 inch, so the page is sized from millimetres rather than
 * from the pixel canvas — that is what makes the printed slab come out at
 * 100 × 144 mm regardless of the export DPI.
 */
export const buildPdf = async (
  pngBuffer: Buffer,
  widthMm: number,
  heightMm: number,
): Promise<Buffer> => {
  const mmToPt = (mm: number) => (mm / 25.4) * 72;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([mmToPt(widthMm), mmToPt(heightMm)]);
  const image = await pdf.embedPng(pngBuffer);

  page.drawImage(image, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  });

  return Buffer.from(await pdf.save());
};
