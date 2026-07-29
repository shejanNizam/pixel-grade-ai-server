import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { SLAB_EXPORT_DPI } from "../../constants";
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
}

/** XML-escape — card names legitimately contain `&` (e.g. "Bill & Co"), which
 *  would otherwise produce malformed SVG and a blank text layer. */
const esc = (value: string): string =>
  value.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c,
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
 * A translucent plate sits behind the text: the background underneath is
 * AI-generated and its brightness is not predictable, and unreadable label text
 * on a printed slab is unrecoverable.
 */
export const buildTextLayer = (
  layout: SlabLayout,
  text: LabelText,
): Buffer => {
  const { labelX, labelY, labelWidth, labelHeight } = layout;

  // ---- Columns ----
  //
  // Tiled from explicit widths that sum to the band's inner width, and laid
  // out from the RIGHT so the QR (a fixed square) anchors the row and every
  // other column falls out of what is left. Positioning each column from its
  // own fraction of the band, as this did originally, let neighbours overlap:
  // the wordmark ran into the card name and the grade printed on top of the
  // Pixel ID. Columns that tile cannot collide.
  const padX = Math.round(labelWidth * 0.035);
  const gap = Math.round(padX * 0.6);
  const inner = labelWidth - padX * 2;

  const qrSize = Math.round(labelHeight * 0.58);
  const qrX = labelX + labelWidth - padX - qrSize;

  const idW = Math.round(inner * 0.17);
  const idRight = qrX - gap;
  const idLeft = idRight - idW;

  const gradeW = Math.round(inner * 0.14);
  const gradeCentre = idLeft - gap - gradeW / 2;
  const gradeLeft = gradeCentre - gradeW / 2;

  const markX = labelX + padX;
  const markW = Math.round(inner * 0.15);
  const infoX = markX + markW + gap;
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
    { tracking = 0, advance = 0.58 }: { tracking?: number; advance?: number } = {},
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
  const markTracking = Math.max(1, Math.round(labelHeight * 0.012));
  const markSize = fitToColumn(
    Math.round(labelHeight * 0.16),
    markW,
    5, // "GRADE" — the longer of the two wordmark lines
    { tracking: markTracking, advance: CAPS_ADVANCE },
  );
  const idSize = fitToColumn(microSize, idW, text.pixelId.length, {
    tracking: 1,
  });

  const verifiedText = "✦ PIXEL VERIFIED";
  const verifiedSize = fitToColumn(microSize, infoW, verifiedText.length, {
    tracking: 1,
    advance: CAPS_ADVANCE,
  });

  const midY = labelY + labelHeight / 2;
  const radius = Math.round(labelHeight * 0.09);

  // Character budget for the free-text column, from its pixel width.
  const nameChars = Math.min(
    MAX_NAME_CHARS,
    Math.max(6, Math.floor(infoW / (nameSize * 0.55))),
  );
  const metaChars = Math.max(6, Math.floor(infoW / (metaSize * 0.55)));

  const setLine = [text.year, text.setExpansion].filter(Boolean).join(" ");
  const numberLine = [text.cardNumber, text.language]
    .filter(Boolean)
    .join("  ·  ");

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .mark   { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #FFFFFF; letter-spacing: ${markTracking}px; }
    .name   { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; fill: #FFFFFF; }
    .meta   { font-family: Helvetica, Arial, sans-serif; fill: #D8D8D8; }
    .micro  { font-family: Helvetica, Arial, sans-serif; fill: #9A9A9A; letter-spacing: 1px; }
    .grade  { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; fill: #FFFFFF; }
    .glabel { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #F0C674; letter-spacing: 2px; }
    .verified { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #4FD1A5; letter-spacing: 1px; }
  </style>

  <rect x="${labelX}" y="${labelY}" width="${labelWidth}" height="${labelHeight}"
        rx="${radius}" ry="${radius}" fill="#0B0B0Cdd" />

  <text x="${markX}" y="${midY - labelHeight * 0.04}" class="mark" font-size="${markSize}">PIXEL</text>
  <text x="${markX}" y="${midY + labelHeight * 0.17}" class="mark" font-size="${markSize}">GRADE</text>

  <line x1="${infoX - gap / 2}" y1="${labelY + labelHeight * 0.18}" x2="${infoX - gap / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${infoX}" y="${labelY + labelHeight * 0.3}" class="name" font-size="${nameSize}">${esc(fit(text.cardName, nameChars))}</text>
  ${setLine ? `<text x="${infoX}" y="${labelY + labelHeight * 0.5}" class="meta" font-size="${metaSize}">${esc(fit(setLine, metaChars))}</text>` : ""}
  ${numberLine ? `<text x="${infoX}" y="${labelY + labelHeight * 0.68}" class="micro" font-size="${microSize}">${esc(fit(numberLine, metaChars))}</text>` : ""}
  ${
    text.pixelVerified
      ? `<text x="${infoX}" y="${labelY + labelHeight * 0.87}" class="verified" font-size="${verifiedSize}">${verifiedText}</text>`
      : ""
  }

  <line x1="${gradeLeft - gap / 2}" y1="${labelY + labelHeight * 0.18}" x2="${gradeLeft - gap / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${gradeCentre}" y="${labelY + labelHeight * 0.58}" class="grade" font-size="${gradeSize}" text-anchor="middle">${esc(gradeText)}</text>
  <text x="${gradeCentre}" y="${labelY + labelHeight * 0.8}" class="glabel" font-size="${gradeLabelSize}" text-anchor="middle">${esc(gradeLabelText)}</text>

  <text x="${idRight}" y="${labelY + labelHeight * 0.42}" class="micro" font-size="${Math.round(idSize * 0.9)}" text-anchor="end">PIXEL ID</text>
  <text x="${idRight}" y="${labelY + labelHeight * 0.6}" class="meta" font-size="${idSize}" text-anchor="end">${esc(text.pixelId)}</text>
  ${
    text.qrDataUri
      ? `<image x="${qrX}" y="${Math.round(midY - qrSize / 2)}" width="${qrSize}" height="${qrSize}" href="${text.qrDataUri}" />`
      : ""
  }
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

  // The moulded tabs at top and bottom centre of a one-touch holder.
  const notchWidth = Math.round(trimWidth * 0.13);
  const notchHeight = Math.max(4, Math.round(trimHeight * 0.011));
  const notchRadius = Math.round(notchHeight / 2);
  const notchX = Math.round(trimX + (trimWidth - notchWidth) / 2);

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

  <rect x="${notchX}" y="${trimY}" width="${notchWidth}" height="${notchHeight}"
        rx="${notchRadius}" ry="${notchRadius}" fill="#FFFFFF" fill-opacity="0.5" />
  <rect x="${notchX}" y="${trimY + trimHeight - notchHeight}"
        width="${notchWidth}" height="${notchHeight}"
        rx="${notchRadius}" ry="${notchRadius}" fill="#FFFFFF" fill-opacity="0.5" />
</svg>`;

  return Buffer.from(svg);
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
 * Builds the finished PNG: background → card image in the fixed window →
 * label text → slab case → optional guides.
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
  options: { showGuides?: boolean; showCase?: boolean } = {},
): Promise<Buffer> => {
  const background = await sharp(backgroundBuffer)
    .resize(layout.canvasWidth, layout.canvasHeight, { fit: "cover" })
    .toBuffer();

  const card = await sharp(cardBuffer)
    .resize(layout.openingWidth, layout.openingHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [
    { input: card, left: layout.openingX, top: layout.openingY },
    { input: buildTextLayer(layout, text), left: 0, top: 0 },
  ];

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
