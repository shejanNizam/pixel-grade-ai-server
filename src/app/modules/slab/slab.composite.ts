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
export const buildTextLayer = (layout: SlabLayout, text: LabelText): Buffer => {
  const { labelX, labelY, labelWidth, labelHeight } = layout;

  // ---- Columns ----
  //
  // Tiled from explicit widths that sum to the band's inner width, and laid
  // out from the RIGHT so the QR column anchors the row and every other column
  // falls out of what is left. Positioning each column from its own fraction of
  // the band, as this did originally, let neighbours overlap: the wordmark ran
  // into the card name and the grade printed on top of the Pixel ID. Columns
  // that tile cannot collide.
  //
  // THREE columns of furniture, not four (client, UI Feedback v1 edit #4):
  //
  //   [ owner avatar + handle ][ card info ][ GRADE ][ QR over PIXEL ID ]
  //
  // The Pixel ID used to own a column of its own; stacking it under the QR is
  // what frees the width that (a) puts the grade next to the QR and (b) widens
  // the card-information column, which were both asked for in the same note.
  // The card info column ends up ~58% wider than it was.
  const padX = Math.round(labelWidth * 0.035);
  const gap = Math.round(padX * 0.6);
  const inner = labelWidth - padX * 2;

  // The QR column holds the code AND the id beneath it, so it is sized by
  // whichever of the two is wider — the id is the longer of the pair at typical
  // sizes, and a column cut to the QR alone would clip it.
  const qrColW = Math.round(inner * 0.19);
  const qrColRight = labelX + labelWidth - padX;
  const qrColLeft = qrColRight - qrColW;
  const qrColCentre = qrColLeft + qrColW / 2;

  // Smaller than the old 0.58 because the column is now shared with two lines
  // of text. At 300 DPI this is still ~10 mm square, which scans reliably for
  // a short URL; going much below that risks a code that will not read off
  // a printed slab.
  const qrSize = Math.min(Math.round(labelHeight * 0.5), qrColW);
  const qrX = Math.round(qrColCentre - qrSize / 2);

  const gradeW = Math.round(inner * 0.14);
  const gradeRight = qrColLeft - gap;
  const gradeLeft = gradeRight - gradeW;
  const gradeCentre = gradeLeft + gradeW / 2;

  // The owner's identity replaces the PIXEL GRADE wordmark.
  const ownerX = labelX + padX;
  const ownerW = Math.round(inner * 0.17);
  const ownerCentre = ownerX + ownerW / 2;

  const infoX = ownerX + ownerW + gap;
  const infoW = gradeLeft - gap - infoX;

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
    Math.round(labelHeight * 0.185),
    infoW,
    Math.min(text.cardName.length, MAX_NAME_CHARS),
    { advance: 0.55 },
  );
  const metaSize = Math.round(labelHeight * 0.115);
  const microSize = Math.round(labelHeight * 0.1);
  const gradeSize = fitToColumn(
    Math.round(labelHeight * 0.42),
    gradeW,
    gradeText.length,
    { advance: 0.62 },
  );
  const gradeLabelSize = fitToColumn(microSize, gradeW, gradeLabelText.length, {
    tracking: 2,
    advance: CAPS_ADVANCE,
  });
  // ---- Owner identity ----
  //
  // The avatar is a disc sized from the band height, with the handle beneath.
  // Both are centred in the column so a short handle does not read as
  // left-aligned against a centred disc.
  const avatarSize = Math.min(Math.round(labelHeight * 0.44), ownerW);
  const avatarX = Math.round(ownerCentre - avatarSize / 2);
  const avatarY = Math.round(labelY + labelHeight * 0.1);
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
    ? fitToColumn(Math.round(labelHeight * 0.105), ownerW, handleText.length, {
        advance: BOLD_ADVANCE,
      })
    : 0;
  const handleChars = handleSize
    ? Math.max(4, Math.floor(ownerW / (handleSize * BOLD_ADVANCE)))
    : 0;

  const initialsSize = Math.round(avatarSize * 0.42);

  // The id sits under the QR now, so it is bounded by the QR column rather than
  // by a column of its own.
  const idSize = fitToColumn(microSize, qrColW, text.pixelId.length, {
    tracking: 1,
  });

  const verifiedText = "✦ PIXEL VERIFIED";
  const verifiedSize = fitToColumn(microSize, infoW, verifiedText.length, {
    tracking: 1,
    advance: CAPS_ADVANCE,
  });

  const radius = Math.round(labelHeight * 0.09);

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

  const numberLine = [text.cardNumber, text.language]
    .filter(Boolean)
    .join("  ·  ");

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .handle { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    .initials { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    .name   { font-family: ${SERIF}; font-weight: 700; fill: #FFFFFF; }
    .meta   { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; }
    .micro  { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; letter-spacing: 1px; }
    .grade  { font-family: ${SANS}; font-weight: 800; fill: #FFFFFF; }
    .glabel { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; letter-spacing: 2px; }
    .verified { font-family: ${SANS}; font-weight: 700; fill: #FFFFFF; letter-spacing: 1px; }
  </style>

  <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
        rx="${radius}" ry="${radius}" fill="#0B0B0C" fill-opacity="${BAND_SCRIM_OPACITY}" />

  <!-- The lit edge of the glass. Without it the frosted panel has no boundary
       and bleeds into the artwork instead of sitting in front of it. -->
  <rect x="${labelX + 1}" y="${labelY + 1}" width="${labelWidth - 2}" height="${labelHeight - 2}"
        rx="${radius}" ry="${radius}"
        fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="2" />

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
  <circle cx="${avatarX + avatarRadius}" cy="${avatarY + avatarRadius}" r="${avatarRadius}"
          fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="2" />
  ${
    handleText
      ? `<text x="${ownerCentre}" y="${labelY + labelHeight * 0.77}" class="handle" font-size="${handleSize}" text-anchor="middle">${esc(fit(handleText, handleChars))}</text>`
      : ""
  }

  <line x1="${infoX - gap / 2}" y1="${labelY + labelHeight * 0.18}" x2="${infoX - gap / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${infoX}" y="${labelY + labelHeight * 0.3}" class="name" font-size="${nameSize}">${esc(fit(text.cardName, nameChars))}</text>
  ${setLine1 ? `<text x="${infoX}" y="${labelY + (setLine2 ? labelHeight * 0.44 : labelHeight * 0.48)}" class="meta" font-size="${metaSize}">${esc(fit(setLine1, metaChars))}</text>` : ""}
  ${setLine2 ? `<text x="${infoX}" y="${labelY + labelHeight * 0.60}" class="meta" font-size="${metaSize}">${esc(fit(setLine2, metaChars))}</text>` : ""}
  ${numberLine ? `<text x="${infoX}" y="${labelY + (setLine2 ? labelHeight * 0.76 : labelHeight * 0.68)}" class="micro" font-size="${metaSize * 0.9}">${esc(fit(numberLine, metaChars))}</text>` : ""}

  <line x1="${gradeLeft - gap / 2}" y1="${labelY + labelHeight * 0.18}" x2="${gradeLeft - gap / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${gradeCentre}" y="${labelY + (text.pixelVerified ? labelHeight * 0.46 : labelHeight * 0.58)}" class="grade" font-size="${gradeSize}" text-anchor="middle">${esc(gradeText)}</text>
  <text x="${gradeCentre}" y="${labelY + (text.pixelVerified ? labelHeight * 0.65 : labelHeight * 0.8)}" class="glabel" font-size="${gradeLabelSize}" text-anchor="middle">${esc(gradeLabelText)}</text>
  ${
    text.pixelVerified
      ? `<text x="${gradeCentre}" y="${labelY + labelHeight * 0.83}" class="verified" font-size="${verifiedSize}" text-anchor="middle">✓ PIXEL VERIFIED</text>`
      : ""
  }

  <!-- QR over the Pixel ID (client, UI Feedback v1 edit #4 — the id used to sit
       in its own column to the left of the code). Both are centred on the
       column so the caption, the value and the code share one axis.

       The QR keeps a white plate behind it: the band is frosted now, and a code
       read against whatever artwork happens to be underneath will not scan. -->
  ${
    text.qrDataUri
      ? `<rect x="${qrX - 3}" y="${avatarY - 3}" width="${qrSize + 6}" height="${qrSize + 6}" rx="4" ry="4" fill="#FFFFFF" />
         <image x="${qrX}" y="${avatarY}" width="${qrSize}" height="${qrSize}" href="${text.qrDataUri}" />`
      : ""
  }
  <text x="${qrColCentre}" y="${labelY + labelHeight * 0.73}" class="micro" font-size="${Math.round(idSize * 0.9)}" text-anchor="middle">PIXEL ID</text>
  <text x="${qrColCentre}" y="${labelY + labelHeight * 0.89}" class="meta" font-size="${idSize}" text-anchor="middle">${esc(text.pixelId)}</text>
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
  const radius = Math.round(labelHeight * 0.09);

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
