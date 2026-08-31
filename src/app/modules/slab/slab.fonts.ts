import { execFileSync } from "child_process";
import { logger } from "../../utils/logger";

/**
 * Boot-time check that this host can actually draw the slab band.
 *
 * The label is an SVG `<text>` layer rasterised by sharp -> librsvg -> pango,
 * which resolves `font-family` through fontconfig against fonts installed on
 * the machine. When none are installed, pango draws an empty hexbox per glyph:
 * the slab still composites, the request still returns 200, and the card name,
 * grade and Pixel ID print as rows of boxes. Nothing in the pipeline fails, so
 * without this the first report of the problem is somebody looking at a label.
 *
 * Warns rather than throws — a running server that prints ugly labels is worth
 * more than one that refuses to start — but the warning names the fix.
 */

/** Families the band's `font-family` stacks actually ask for, lower-cased. */
const EXPECTED_FAMILIES = ["dejavu", "liberation", "noto", "arial", "helvetica"];

/**
 * Families that can actually draw Japanese, lower-cased.
 *
 * Checked separately because the Latin check above cannot stand in for it, and
 * for a week it silently did: DejaVu and Liberation satisfy `EXPECTED_FAMILIES`
 * while containing not one CJK glyph between them, so a host with exactly the
 * fonts `.ebextensions/02_fonts.config` installed reported "fonts available"
 * and then printed every Japanese card name as a row of empty boxes. Japanese
 * printings are a first-class case here — Scrydex returns them and the band
 * prints `language: "Japanese"` beneath them.
 *
 * "noto" alone is not enough of a match: Noto Sans is Latin-only and ships
 * separately from Noto Sans CJK.
 */
const CJK_FAMILIES = [
  "noto sans cjk",
  "noto serif cjk",
  "noto sans jp",
  "noto serif jp",
  "ipaexgothic",
  "ipaexmincho",
  "ipagothic",
  "vl gothic",
  "takaogothic",
  "sazanami",
  "meiryo",
  "yu gothic",
  "ms gothic",
  "hiragino",
];

export const warnIfFontsMissing = (): void => {
  // fontconfig is a Linux concern; Windows and macOS dev boxes resolve fonts
  // through the OS and have no fc-list to ask.
  if (process.platform !== "linux") return;

  let families: string;
  try {
    families = execFileSync("fc-list", [":", "family"], {
      encoding: "utf8",
      timeout: 5_000,
    });
  } catch {
    logger.warn(
      "fontconfig is not installed (fc-list is missing) — slab label text will " +
        "render as empty boxes. Install fontconfig and a font package " +
        "(dejavu-sans-fonts, liberation-sans-fonts) on this host; see " +
        ".ebextensions/02_fonts.config.",
    );
    return;
  }

  const available = families.toLowerCase();
  const matched = EXPECTED_FAMILIES.filter((family) =>
    available.includes(family),
  );

  if (matched.length === 0) {
    logger.warn(
      "No font matching the slab label's font-family stack is installed — " +
        "label text will render as empty boxes. Expected one of: " +
        `${EXPECTED_FAMILIES.join(", ")}. Run 'fc-list' on the host and see ` +
        ".ebextensions/02_fonts.config.",
    );
    return;
  }

  const cjk = CJK_FAMILIES.filter((family) => available.includes(family));
  if (cjk.length === 0) {
    logger.warn(
      "No CJK font is installed — Japanese card names and set names will " +
        "render as empty boxes on the slab label. Latin text is unaffected, " +
        "which is why this needs its own check: DejaVu and Liberation satisfy " +
        "the Latin stack and contain no CJK glyphs at all. Install a Noto CJK " +
        "package on this host; see .ebextensions/02_fonts.config.",
    );
  }

  logger.info(
    `Slab label fonts available: ${matched.join(", ")}` +
      (cjk.length ? ` · CJK: ${cjk.join(", ")}` : " · CJK: none"),
  );
};
