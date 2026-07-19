import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { IGradingReport } from "./grading.interface";

/**
 * Grading report PDF.
 *
 * Rendered on demand and streamed, never persisted: the watermark depends on
 * the owner's plan AT DOWNLOAD TIME, so a cached file would hand a Free user a
 * clean report after downgrade (or keep watermarking a paying one). The
 * underlying report data is permanent; the PDF is a cheap derived artifact.
 */

/** What the renderer needs from the populated card document. */
export interface ReportCardInfo {
  name?: string;
  setExpansion?: string;
  cardNumber?: string;
  rarity?: string;
}

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;

const VIOLET = rgb(0.48, 0.35, 0.9);
const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.45, 0.45, 0.5);
const FAINT = rgb(0.88, 0.88, 0.92);

/** Standard fonts are WinAnsi-only; the model's reasoning text can contain
 *  arbitrary unicode, which would make pdf-lib throw mid-render. */
const sanitize = (text: string): string =>
  text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\xFF\n]/g, "");

const wrap = (
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number,
): string[] => {
  const lines: string[] = [];
  for (const paragraph of sanitize(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
};

const drawWatermark = (page: PDFPage, font: PDFFont) => {
  const text = "PIXELGRADE AI - FREE PLAN";
  const size = 42;
  const width = font.widthOfTextAtSize(text, size);
  // Three diagonal repetitions cover the page without obscuring the scores.
  for (const y of [PAGE_H * 0.25, PAGE_H * 0.55, PAGE_H * 0.85]) {
    page.drawText(text, {
      x: (PAGE_W - width) / 2 - 40,
      y,
      size,
      font,
      color: rgb(0.85, 0.82, 0.95),
      opacity: 0.5,
      rotate: degrees(-24),
    });
  }
};

export const buildReportPdf = async (
  report: IGradingReport,
  card: ReportCardInfo,
  watermark: boolean,
): Promise<Buffer> => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Watermark sits under the content, so it can never make a score unreadable.
  if (watermark) drawWatermark(page, bold);

  let y = PAGE_H - MARGIN;

  // ---- header -------------------------------------------------------------
  page.drawText("PixelGrade AI", { x: MARGIN, y, size: 22, font: bold, color: VIOLET });
  page.drawText("AI GRADING REPORT", {
    x: PAGE_W - MARGIN - regular.widthOfTextAtSize("AI GRADING REPORT", 10),
    y: y + 6,
    size: 10,
    font: regular,
    color: MUTED,
  });
  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_W - MARGIN, y },
    thickness: 1,
    color: FAINT,
  });
  y -= 36;

  // ---- card identity ------------------------------------------------------
  page.drawText(sanitize(card.name ?? "Unknown card"), { x: MARGIN, y, size: 18, font: bold, color: INK });
  y -= 18;
  const subtitle = [card.setExpansion, card.cardNumber, card.rarity]
    .filter(Boolean)
    .join("  ·  ");
  if (subtitle) {
    page.drawText(sanitize(subtitle), { x: MARGIN, y, size: 10, font: regular, color: MUTED });
    y -= 10;
  }
  y -= 30;

  // ---- grade block --------------------------------------------------------
  const gradeText = report.grade.toFixed(1);
  page.drawText(gradeText, { x: MARGIN, y: y - 26, size: 52, font: bold, color: VIOLET });
  const gradeX = MARGIN + bold.widthOfTextAtSize(gradeText, 52) + 16;
  page.drawText(sanitize(String(report.gradeLabel)), { x: gradeX, y: y - 4, size: 14, font: bold, color: INK });
  page.drawText(`AI grade estimate  ·  ${report.confidence}% confidence`, {
    x: gradeX,
    y: y - 20,
    size: 9,
    font: regular,
    color: MUTED,
  });
  if (report.pixelVerified) {
    page.drawText("PIXEL VERIFIED", { x: gradeX, y: y - 36, size: 9, font: bold, color: rgb(0.15, 0.45, 0.85) });
  }
  y -= 76;

  // ---- sub-scores ---------------------------------------------------------
  const scores: [string, number][] = [
    ["Surface", report.scoreSurface],
    ["Corners", report.scoreCorners],
    ["Edges", report.scoreEdges],
    ["Centering", report.scoreCentering],
  ];
  const colWidth = (PAGE_W - MARGIN * 2) / scores.length;
  scores.forEach(([label, value], i) => {
    const x = MARGIN + i * colWidth;
    page.drawRectangle({
      x,
      y: y - 44,
      width: colWidth - 8,
      height: 52,
      borderColor: FAINT,
      borderWidth: 1,
    });
    page.drawText(label, { x: x + 10, y: y - 12, size: 9, font: regular, color: MUTED });
    page.drawText(value.toFixed(1), { x: x + 10, y: y - 34, size: 16, font: bold, color: INK });
  });
  y -= 76;

  // ---- reasoning ----------------------------------------------------------
  if (report.reasoning) {
    page.drawText("ASSESSMENT", { x: MARGIN, y, size: 9, font: bold, color: MUTED });
    y -= 16;
    for (const line of wrap(regular, report.reasoning, 10, PAGE_W - MARGIN * 2)) {
      if (y < MARGIN + 60) break; // keep the footer clear; reasoning is advisory
      page.drawText(line, { x: MARGIN, y, size: 10, font: regular, color: INK, lineHeight: 14 });
      y -= 14;
    }
  }

  // ---- footer -------------------------------------------------------------
  const footerY = MARGIN;
  page.drawLine({
    start: { x: MARGIN, y: footerY + 24 },
    end: { x: PAGE_W - MARGIN, y: footerY + 24 },
    thickness: 1,
    color: FAINT,
  });
  page.drawText(
    `Report ${String(report._id)}  ·  Model ${sanitize(report.modelVersion)}  ·  Generated ${new Date().toISOString().slice(0, 10)}`,
    { x: MARGIN, y: footerY + 8, size: 8, font: regular, color: MUTED },
  );
  page.drawText(
    "AI-estimated grade. Not a substitute for professional grading services.",
    { x: MARGIN, y: footerY - 4, size: 8, font: regular, color: MUTED },
  );

  return Buffer.from(await pdf.save());
};
