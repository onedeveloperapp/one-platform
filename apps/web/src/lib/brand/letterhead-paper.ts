import { strFromU8, unzipSync } from "fflate";

import { writeDocxBody } from "@/lib/brand/letterhead-docx";

/**
 * The firm's Word letterhead made ready to be copied (the owner, 2026-11-25: "não é pra inventar, mas sim copiar ...
 * exatamente como o usuário enviou, a não ser que seja um arquivo que tenha conteúdo, aí desconsidere o conteúdo").
 * ONE's server turns the document into a PDF with the office suite (`@flyee/documents/office`) and keeps that PDF as
 * the firm's paper; before, the document's body is emptied here, so what comes out is the paper and nothing else.
 *
 * - `letterheadPagesDocx` keeps every part of the document (its headers and footers with their pictures, shapes and
 *   colours, its styles, its page and margins) and writes its body again as two empty pages: the first page, whose
 *   header may be its own, and a following one. What the body anchors on the page (a picture or a box laid on it, as
 *   some letterheads are made) stays, its own text out; everything else of the body (the text of a piece, a table)
 *   goes.
 * - `docxPageMargins` reads where the document puts its text, so ONE never writes closer to the edges than the firm.
 * - `docxFonts` names the fonts the letterhead writes in, and `missingFonts` says which of them the server had no
 *   font for, nor one of the same measure: there the copy may differ a little from what Word draws, and the person is
 *   told so, with the way to an exact one (the PDF Word saves).
 *
 * Pure but for the unzipping: no I/O, no clock.
 */

/** The most a letterhead's parts read here may unpack to. */
const MOST_UNPACKED = 40 * 1024 * 1024;

const TWIPS_PER_POINT = 20;

/** The children of an element's inside, each whole: their open tag's name and their text. */
function childrenOf(inside: string): { name: string; xml: string }[] {
  const children: { name: string; xml: string }[] = [];
  const tag = /<(\/?)((?:[A-Za-z_][\w.-]*:)?[A-Za-z_][\w.-]*)\b[^>]*?(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>/g;
  let depth = 0;
  let start = -1;
  let name = "";
  for (const match of inside.matchAll(tag)) {
    if (match[2] === undefined) continue;
    const closing = match[1] === "/";
    const selfClosed = match[3] === "/";
    if (!closing && depth === 0) {
      start = match.index!;
      name = match[2];
    }
    if (closing) depth -= 1;
    else if (!selfClosed) depth += 1;
    if (depth === 0 && start >= 0) {
      children.push({ name, xml: inside.slice(start, match.index! + match[0].length) });
      start = -1;
    }
  }
  return children;
}

/** A paragraph of the body that lays something on the page (a picture or a box anchored to it), without its text. */
function anchoredOnly(paragraph: string): string | null {
  if (!/<(?:\w+:)?anchor\b|<(?:\w+:)?pict\b/.test(paragraph)) return null;
  // The text of a box laid on the page is the paper's; the paragraph's own text is the document's.
  return paragraph
    .split(/(<(?:\w+:)?txbxContent\b[\s\S]*?<\/(?:\w+:)?txbxContent>)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/<((?:\w+:)?t)(?:\s[^>]*)?>[^<]*<\/\1>/g, "")))
    .join("");
}

/**
 * The document with its body made two empty pages, the first page's anchored pictures and boxes kept; null when it
 * is no Word document whose body can be found.
 */
export function letterheadPagesDocx(docx: Uint8Array): Uint8Array | null {
  return writeDocxBody(docx, (inside) => {
    const kept = childrenOf(inside)
      .filter((child) => /(^|:)p$/.test(child.name))
      .flatMap((child) => {
        const anchored = anchoredOnly(child.xml);
        return anchored ? [anchored] : [];
      });
    // An empty paragraph after the break: the suite gives a page only to a break that something follows.
    return (kept.length > 0 ? kept.join("") : "<w:p/>") + '<w:p><w:r><w:br w:type="page"/></w:r></w:p><w:p/>';
  });
}

function unpack(docx: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> | null {
  let unpacked = 0;
  try {
    return unzipSync(docx, {
      filter: (file) => {
        if (!wanted(file.name)) return false;
        unpacked += file.originalSize;
        if (unpacked > MOST_UNPACKED) throw new Error("too_large");
        return true;
      },
    });
  } catch {
    return null;
  }
}

const attribute = (attributes: string, name: string): string | null =>
  new RegExp(`(?:^|\\s)(?:\\w+:)?${name}="([^"]*)"`).exec(attributes)?.[1] ?? null;

/** Where the document puts its text, from each edge, in points; null when it is no Word document. */
export function docxPageMargins(docx: Uint8Array): { top: number; bottom: number; left: number; right: number } | null {
  const files = unpack(docx, (name) => name === "word/document.xml");
  const document = files?.["word/document.xml"];
  if (!document) return null;
  const xml = strFromU8(document);
  const section = [...xml.matchAll(/<(?:\w+:)?sectPr\b[\s\S]*?<\/(?:\w+:)?sectPr>/g)].at(-1)?.[0] ?? "";
  const margin = /<(?:\w+:)?pgMar\b([^>]*)\/?>/.exec(section)?.[1] ?? "";
  const twips = (name: string, fallback: number) => {
    const value = Number.parseFloat(attribute(margin, name) ?? "");
    return Math.abs(Number.isFinite(value) ? value : fallback) / TWIPS_PER_POINT;
  };
  return {
    top: twips("top", 1440),
    bottom: twips("bottom", 1440),
    left: twips("left", 1440),
    right: twips("right", 1440),
  };
}

/**
 * The fonts the letterhead writes its text in: the font each run of its headers and footers that shows text names, or
 * the document's own (its default, or the theme's it names) for a run that names none.
 */
export function docxFonts(docx: Uint8Array): string[] {
  const files = unpack(
    docx,
    (name) =>
      /^word\/(header|footer)\d*\.xml$/.test(name) || name === "word/styles.xml" || name === "word/theme/theme1.xml",
  );
  if (!files) return [];
  const fonts = new Set<string>();
  const theme = files["word/theme/theme1.xml"] ? strFromU8(files["word/theme/theme1.xml"]) : "";
  const themed = (which: string | null): string | null => {
    if (!which) return null;
    const block = new RegExp(
      `<(?:\\w+:)?${which.startsWith("major") ? "majorFont" : "minorFont"}>[\\s\\S]*?<\\/(?:\\w+:)?(?:major|minor)Font>`,
    ).exec(theme)?.[0];
    return block ? attribute(/<(?:\w+:)?latin\b([^>]*)\/?>/.exec(block)?.[1] ?? "", "typeface") : null;
  };
  const named = (attributes: string): string | null =>
    attribute(attributes, "ascii") ?? attribute(attributes, "hAnsi") ?? themed(attribute(attributes, "asciiTheme"));

  const styles = files["word/styles.xml"] ? strFromU8(files["word/styles.xml"]) : "";
  const defaults = /<(?:\w+:)?docDefaults[\s\S]*?<\/(?:\w+:)?docDefaults>/.exec(styles)?.[0] ?? "";
  const own = named(/<(?:\w+:)?rFonts\b([^>]*)\/?>/.exec(defaults)?.[1] ?? "");

  for (const [name, bytes] of Object.entries(files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    const xml = strFromU8(bytes);
    for (const run of xml.matchAll(/<(?:\w+:)?r\b[^>]*>([\s\S]*?)<\/(?:\w+:)?r>/g)) {
      const inner = run[1] ?? "";
      const text = /<(?:\w+:)?t\b[^>]*>([^<]*)</.exec(inner)?.[1] ?? "";
      if (text.trim() === "") continue;
      // A run that names no font writes in the document's own.
      const font = named(/<(?:\w+:)?rFonts\b([^>]*)\/?>/.exec(inner)?.[1] ?? "") ?? own;
      if (font) fonts.add(font);
    }
  }
  return [...fonts].sort((a, b) => a.localeCompare(b));
}

/**
 * A font's name to compare by: no spaces, no case, no weight or style after a hyphen or a comma, and no maker's mark
 * a PDF adds to it (Times New Roman is written "TimesNewRomanPSMT").
 */
const keyOf = (font: string): string =>
  font
    .split(/[-,]/)[0]!
    .replace(/\s+/g, "")
    .toLowerCase()
    .replace(/(psmt|mt)$/, "");

/**
 * The fonts of the same measure the server writes in the place of Microsoft's (the office suite's own image carries
 * them): the text keeps its width, so nothing moves.
 */
const SAME_MEASURE: Record<string, string> = {
  arial: "liberationsans",
  helvetica: "liberationsans",
  timesnewroman: "liberationserif",
  times: "liberationserif",
  couriernew: "liberationmono",
  courier: "liberationmono",
  calibri: "carlito",
  cambria: "caladea",
};

/**
 * Of the fonts the letterhead asks for, those the copy was not written in, nor in one of the same measure: there the
 * server wrote another font, and the text in it may sit a little off.
 */
export function missingFonts(requested: readonly string[], written: readonly string[]): string[] {
  const used = new Set(written.map(keyOf));
  return requested.filter((font) => {
    const key = keyOf(font);
    if (used.has(key)) return false;
    const same = SAME_MEASURE[key];
    return !(same && used.has(same));
  });
}

/** Where the firm's paper stands (0300): what the step says of it. */
export type LetterheadPaper = {
  status: "converting" | "ready" | "failed" | null;
  /** Why ONE could not copy it. */
  problem: string | null;
  /** The fonts of the letterhead the server had none of the same measure for: there the copy may differ a little. */
  missing: string[];
  /** The text of a document was taken out of the paper. */
  stripped: boolean;
};

/** The paper as the database keeps it (0300), as the step says it. */
export function paperOf(
  row: {
    letterhead_kind?: string | null;
    letterhead_paper_status?: string | null;
    letterhead_paper_problem?: string | null;
    letterhead_paper?: unknown;
  } | null,
): LetterheadPaper {
  const status = row?.letterhead_paper_status;
  const kept = (row?.letterhead_paper ?? {}) as { missing?: unknown; stripped?: unknown };
  return {
    // A PDF letterhead read before 0300 is its own paper.
    status:
      status === "converting" || status === "ready" || status === "failed"
        ? status
        : row?.letterhead_kind === "pdf"
          ? "ready"
          : null,
    problem: row?.letterhead_paper_problem ?? null,
    missing: Array.isArray(kept.missing) ? kept.missing.filter((font): font is string => typeof font === "string") : [],
    stripped: kept.stripped === true,
  };
}
