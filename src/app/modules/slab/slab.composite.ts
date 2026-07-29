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

  // Column boundaries as fractions of the band width.
  const padX = Math.round(labelWidth * 0.035);
  const markX = labelX + padX;
  const markW = Math.round(labelWidth * 0.15);
  const infoX = markX + markW + padX;
  const gradeW = Math.round(labelWidth * 0.16);
  const qrW = Math.round(labelHeight * 0.62);
  const qrX = labelX + labelWidth - padX - qrW;
  const idX = qrX - padX;
  const gradeX = idX - Math.round(labelWidth * 0.055) - gradeW / 2;
  const infoW = gradeX - gradeW / 2 - infoX - padX;

  // Type scale is driven by band HEIGHT, not width: 20 mm is the binding
  // constraint, and sizing from width overflows the band on a wide slab.
  const nameSize = Math.round(labelHeight * 0.2);
  const metaSize = Math.round(labelHeight * 0.125);
  const microSize = Math.round(labelHeight * 0.105);
  const gradeSize = Math.round(labelHeight * 0.44);
  const markSize = Math.round(labelHeight * 0.17);

  const midY = labelY + labelHeight / 2;
  const radius = Math.round(labelHeight * 0.09);

  // Rough character budget for each text column, from its pixel width and the
  // average glyph advance (~0.55em for the faces used here).
  const nameChars = Math.max(6, Math.floor(infoW / (nameSize * 0.55)));
  const metaChars = Math.max(6, Math.floor(infoW / (metaSize * 0.55)));

  const setLine = [text.year, text.setExpansion].filter(Boolean).join(" ");
  const numberLine = [text.cardNumber, text.language]
    .filter(Boolean)
    .join("  ·  ");

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .mark   { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #FFFFFF; letter-spacing: ${Math.max(1, Math.round(labelHeight * 0.02))}px; }
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

  <line x1="${infoX - padX / 2}" y1="${labelY + labelHeight * 0.18}" x2="${infoX - padX / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${infoX}" y="${labelY + labelHeight * 0.34}" class="name" font-size="${nameSize}">${esc(fit(text.cardName, nameChars))}</text>
  ${setLine ? `<text x="${infoX}" y="${labelY + labelHeight * 0.56}" class="meta" font-size="${metaSize}">${esc(fit(setLine, metaChars))}</text>` : ""}
  ${numberLine ? `<text x="${infoX}" y="${labelY + labelHeight * 0.74}" class="micro" font-size="${microSize}">${esc(fit(numberLine, metaChars))}</text>` : ""}
  ${
    text.pixelVerified
      ? `<text x="${infoX}" y="${labelY + labelHeight * 0.9}" class="verified" font-size="${microSize}">✦ PIXEL VERIFIED</text>`
      : ""
  }

  <line x1="${gradeX - gradeW / 2 - padX / 2}" y1="${labelY + labelHeight * 0.18}" x2="${gradeX - gradeW / 2 - padX / 2}" y2="${labelY + labelHeight * 0.82}"
        stroke="#FFFFFF" stroke-opacity="0.22" stroke-width="2" />

  <text x="${gradeX}" y="${labelY + labelHeight * 0.6}" class="grade" font-size="${gradeSize}" text-anchor="middle">${formatGrade(text.grade)}</text>
  <text x="${gradeX}" y="${labelY + labelHeight * 0.82}" class="glabel" font-size="${microSize}" text-anchor="middle">${esc(text.gradeLabel.toUpperCase())}</text>

  <text x="${idX}" y="${labelY + labelHeight * 0.36}" class="micro" font-size="${microSize}" text-anchor="end">PIXEL ID</text>
  <text x="${idX}" y="${labelY + labelHeight * 0.54}" class="meta" font-size="${microSize}" text-anchor="end">${esc(text.pixelId)}</text>
  ${
    text.qrDataUri
      ? `<image x="${qrX}" y="${Math.round(midY - qrW / 2)}" width="${qrW}" height="${qrW}" href="${text.qrDataUri}" />`
      : ""
  }
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
 * label text → optional guides.
 *
 * The card is fitted with `contain`, not `cover`. A card whose aspect ratio
 * differs slightly from the 65×90 window must be letterboxed, never cropped —
 * cropping would cut the card's own edges, which are exactly what the grade is
 * about.
 */
export const compositePng = async (
  layout: SlabLayout,
  backgroundBuffer: Buffer,
  cardBuffer: Buffer,
  text: LabelText,
  options: { showGuides?: boolean } = {},
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
