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
  grade: number;
  gradeLabel: string;
  pixelVerified: boolean;
  certNumber: string;
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
 * Label text as an SVG overlay sized to the full canvas, so it can be
 * composited at (0,0) without offset maths.
 */
export const buildTextLayer = (
  layout: SlabLayout,
  text: LabelText,
): Buffer => {
  const centreX = layout.trimX + layout.trimWidth / 2;
  const base = layout.labelY + Math.round(layout.labelHeight * 0.22);
  const nameSize = Math.round(layout.trimWidth * 0.062);
  const metaSize = Math.round(layout.trimWidth * 0.036);
  const gradeSize = Math.round(layout.trimWidth * 0.13);

  const meta = [text.setExpansion, text.cardNumber, text.language]
    .filter(Boolean)
    .join("  ·  ");

  const svg = `<svg width="${layout.canvasWidth}" height="${layout.canvasHeight}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .name  { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; fill: #FFFFFF; }
    .meta  { font-family: Helvetica, Arial, sans-serif; fill: #D8D8D8; letter-spacing: 1.5px; }
    .grade { font-family: Georgia, 'Times New Roman', serif; font-weight: 700; fill: #FFFFFF; }
    .label { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #F0C674; letter-spacing: 3px; }
    .cert  { font-family: Helvetica, Arial, sans-serif; fill: #9A9A9A; letter-spacing: 1px; }
    .verified { font-family: Helvetica, Arial, sans-serif; font-weight: 700; fill: #4FD1A5; letter-spacing: 2px; }
  </style>
  <text x="${centreX}" y="${base}" class="name" font-size="${nameSize}" text-anchor="middle">${esc(fit(text.cardName, 26))}</text>
  ${meta ? `<text x="${centreX}" y="${base + metaSize * 1.6}" class="meta" font-size="${metaSize}" text-anchor="middle">${esc(fit(meta, 42))}</text>` : ""}
  <text x="${centreX}" y="${base + gradeSize * 1.55}" class="grade" font-size="${gradeSize}" text-anchor="middle">${text.grade.toFixed(1)}</text>
  <text x="${centreX}" y="${base + gradeSize * 1.95}" class="label" font-size="${metaSize}" text-anchor="middle">${esc(text.gradeLabel)}</text>
  ${
    text.pixelVerified
      ? `<text x="${centreX}" y="${base + gradeSize * 2.35}" class="verified" font-size="${Math.round(metaSize * 0.9)}" text-anchor="middle">✦ PIXEL VERIFIED</text>`
      : ""
  }
  <text x="${centreX}" y="${layout.trimY + layout.trimHeight - Math.round(layout.trimHeight * 0.018)}" class="cert" font-size="${Math.round(metaSize * 0.8)}" text-anchor="middle">CERT ${esc(text.certNumber)}</text>
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
