import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * The firm's letterhead from a Word document it already writes on (the plan "o escritório preparado antes do
 * primeiro atendimento", phase 2, the owner, 2026-11-20). The library's reader leaves the header and the footer out
 * (they are the letterhead, not the model's text); here they are what is kept:
 *
 * - `readDocxLetterhead` reads, of the document's last section, the page's size and margins, the header and the
 *   footer Word prints on its pages (the default ones, else the first page's), each as its lines of text (with their
 *   alignment, size and weight) and its pictures (PNG or JPEG, with their size on the page), and the font the
 *   document writes in. That is what ONE draws on the PDF of a piece, an approximation the person checks on a page of
 *   example before it is used.
 * - `writeDocxOnLetterhead` writes blocks of text into the firm's own document: its body replaced, everything else
 *   kept (the header and the footer, their pictures, the styles, the font, the margins), so the Word file the firm
 *   downloads is on its letterhead exactly.
 *
 * Pure but for the unzipping: no I/O, no clock. The elements are read by their names, with or without a prefix.
 */

/** The most the parts read may unpack to: a letterhead's pictures are a few megabytes. */
const MOST_UNPACKED = 40 * 1024 * 1024;

const TWIPS_PER_POINT = 20;
const EMU_PER_POINT = 12700;

export type Align = "left" | "center" | "right";

export type LetterheadLine = { text: string; align: Align; sizePt: number; bold: boolean };

export type LetterheadImage = {
  /** The part of the package (`word/media/image1.png`). */
  part: string;
  mime: "image/png" | "image/jpeg";
  widthPt: number;
  heightPt: number;
  align: Align;
};

export type LetterheadBand = { lines: LetterheadLine[]; images: LetterheadImage[] };

export type PageBox = {
  width: number;
  height: number;
  /** Where the text goes, from each edge; `header` and `footer` from the top and the bottom edge to the bands. */
  margins: { top: number; bottom: number; left: number; right: number; header: number; footer: number };
};

export type DocxLetterhead =
  | {
      ok: true;
      page: PageBox;
      header: LetterheadBand;
      footer: LetterheadBand;
      /** The font the document writes in, by its name; null when it does not say. */
      font: string | null;
      /** The pictures of the bands, by their part, for ONE to keep and draw. */
      media: Record<string, Uint8Array>;
    }
  | { ok: false; code: "not_docx" | "too_large" | "no_letterhead" };

type Token =
  | { kind: "open"; name: string; attributes: string; closed: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[entity] ?? whole;
  });

function* tokens(xml: string): Generator<Token> {
  const pattern =
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!(?:[^>])*>|<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)((?:\s[^>]*?)?)(\/?)>|([^<]+)/g;
  for (const match of xml.matchAll(pattern)) {
    if (match[1] !== undefined) yield { kind: "text", text: match[1] };
    else if (match[3] !== undefined) {
      if (match[2] === "/") yield { kind: "close", name: match[3] };
      else yield { kind: "open", name: match[3], attributes: match[4] ?? "", closed: match[5] === "/" };
    } else if (match[6] !== undefined) yield { kind: "text", text: decode(match[6]) };
  }
}

function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attributes);
  return found ? decode(found[2] ?? found[3] ?? "") : null;
}

const number = (value: string | null): number | null => {
  const read = value === null ? Number.NaN : Number(value);
  return Number.isFinite(read) ? read : null;
};

const alignOf = (value: string | null): Align =>
  value === "center" ? "center" : value === "right" || value === "end" ? "right" : "left";

/** The relationships of a part: its ids and where they point, relative to the part's folder. */
function relationships(xml: string | null): Map<string, string> {
  const found = new Map<string, string>();
  if (!xml) return found;
  for (const token of tokens(xml)) {
    if (token.kind !== "open" || token.name !== "Relationship") continue;
    const id = attribute(token.attributes, "Id");
    const target = attribute(token.attributes, "Target");
    if (id && target && attribute(token.attributes, "TargetMode") !== "External") found.set(id, target);
  }
  return found;
}

/** A target relative to `word/`, as a part's name. */
const partOf = (target: string): string => {
  const clean = target.replace(/^\/+/, "");
  if (clean.startsWith("word/")) return clean;
  const parts: string[] = ["word"];
  for (const piece of clean.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece && piece !== ".") parts.push(piece);
  }
  return parts.join("/");
};

const MIMES: Record<string, LetterheadImage["mime"]> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

/** The lines and pictures of a header or a footer. */
function readBand(xml: string, rels: Map<string, string>): LetterheadBand {
  const lines: LetterheadLine[] = [];
  const images: LetterheadImage[] = [];
  let paragraph: { text: string; align: Align; size: number | null; bold: boolean; inRun: boolean } | null = null;
  let extent: { width: number; height: number } | null = null;
  let vmlSize: { width: number; height: number } | null = null;
  const stack: string[] = [];
  for (const token of tokens(xml)) {
    if (token.kind === "text") {
      if (paragraph && stack.at(-1) === "t") paragraph.text += token.text;
      continue;
    }
    if (token.kind === "close") {
      stack.pop();
      if (token.name === "p" && paragraph) {
        const text = paragraph.text.replace(/\s+/g, " ").trim();
        if (text) {
          lines.push({ text, align: paragraph.align, sizePt: (paragraph.size ?? 22) / 2, bold: paragraph.bold });
        }
        paragraph = null;
      }
      continue;
    }
    if (!token.closed) stack.push(token.name);
    if (token.name === "p") {
      paragraph = { text: "", align: "left", size: null, bold: false, inRun: false };
    } else if (paragraph && token.name === "jc" && stack.includes("pPr")) {
      paragraph.align = alignOf(attribute(token.attributes, "val"));
    } else if (paragraph && token.name === "sz" && stack.includes("rPr") && stack.includes("r")) {
      paragraph.size ??= number(attribute(token.attributes, "val"));
    } else if (paragraph && token.name === "b" && stack.includes("rPr") && stack.includes("r")) {
      const value = attribute(token.attributes, "val");
      if (value !== "0" && value !== "false") paragraph.bold = true;
    } else if (paragraph && (token.name === "tab" || token.name === "br") && stack.includes("r")) {
      paragraph.text += " ";
    } else if (token.name === "extent") {
      const cx = number(attribute(token.attributes, "cx"));
      const cy = number(attribute(token.attributes, "cy"));
      extent = cx && cy ? { width: cx / EMU_PER_POINT, height: cy / EMU_PER_POINT } : null;
    } else if (token.name === "shape") {
      const style = attribute(token.attributes, "style") ?? "";
      const width = /width:\s*([\d.]+)pt/.exec(style);
      const height = /height:\s*([\d.]+)pt/.exec(style);
      vmlSize = width && height ? { width: Number(width[1]), height: Number(height[1]) } : null;
    } else if (token.name === "blip" || token.name === "imagedata") {
      const id = attribute(token.attributes, "embed") ?? attribute(token.attributes, "id");
      const target = id ? rels.get(id) : undefined;
      const size = token.name === "blip" ? extent : vmlSize;
      if (target && size) {
        const part = partOf(target);
        const mime = MIMES[part.split(".").pop()?.toLowerCase() ?? ""];
        if (mime)
          images.push({ part, mime, widthPt: size.width, heightPt: size.height, align: paragraph?.align ?? "left" });
      }
    }
  }
  return { lines, images };
}

/** The font the document writes in: its default, or the theme's font it names. */
function fontOf(styles: string | null, theme: string | null): string | null {
  if (!styles) return null;
  const defaults = /<(?:\w+:)?docDefaults[\s\S]*?<\/(?:\w+:)?docDefaults>/.exec(styles)?.[0] ?? "";
  const fonts = /<(?:\w+:)?rFonts\b([^>]*)\/?>/.exec(defaults)?.[1] ?? "";
  const named = attribute(fonts, "ascii") ?? attribute(fonts, "hAnsi");
  if (named) return named;
  const themed = attribute(fonts, "asciiTheme") ?? attribute(fonts, "hAnsiTheme");
  if (!themed || !theme) return null;
  const which = themed.startsWith("major") ? "majorFont" : "minorFont";
  const block = new RegExp(`<(?:\\w+:)?${which}>[\\s\\S]*?<\\/(?:\\w+:)?${which}>`).exec(theme)?.[0] ?? "";
  return attribute(/<(?:\w+:)?latin\b([^>]*)\/?>/.exec(block)?.[1] ?? "", "typeface");
}

const isDocx = (files: Record<string, Uint8Array>): boolean => "word/document.xml" in files;

/** The firm's letterhead in a Word document it writes on. */
export function readDocxLetterhead(bytes: Uint8Array, mostUnpacked = MOST_UNPACKED): DocxLetterhead {
  let unpacked = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        const wanted =
          file.name === "word/document.xml" ||
          file.name === "word/_rels/document.xml.rels" ||
          file.name === "word/styles.xml" ||
          file.name === "word/theme/theme1.xml" ||
          /^word\/(header|footer)\d*\.xml$/.test(file.name) ||
          /^word\/_rels\/(header|footer)\d*\.xml\.rels$/.test(file.name) ||
          /^word\/media\/[^/]+\.(png|jpe?g)$/i.test(file.name);
        if (!wanted) return false;
        unpacked += file.originalSize;
        if (unpacked > mostUnpacked) throw new Error("too_large");
        return true;
      },
    });
  } catch (error) {
    return { ok: false, code: error instanceof Error && error.message === "too_large" ? "too_large" : "not_docx" };
  }
  if (!isDocx(files)) return { ok: false, code: "not_docx" };
  const text = (name: string): string | null => (files[name] ? strFromU8(files[name]!) : null);
  const document = text("word/document.xml") ?? "";
  const documentRels = relationships(text("word/_rels/document.xml.rels"));

  // The last section's properties: the page, its margins, its header and its footer.
  const sections = [...document.matchAll(/<(?:\w+:)?sectPr\b[\s\S]*?<\/(?:\w+:)?sectPr>/g)];
  const section = sections.at(-1)?.[0] ?? "";
  const size = /<(?:\w+:)?pgSz\b([^>]*)\/?>/.exec(section)?.[1] ?? "";
  const margin = /<(?:\w+:)?pgMar\b([^>]*)\/?>/.exec(section)?.[1] ?? "";
  const twips = (attributes: string, name: string, fallback: number) =>
    (number(attribute(attributes, name)) ?? fallback) / TWIPS_PER_POINT;
  const page: PageBox = {
    width: twips(size, "w", 11906),
    height: twips(size, "h", 16838),
    margins: {
      top: Math.abs(twips(margin, "top", 1440)),
      bottom: Math.abs(twips(margin, "bottom", 1440)),
      left: twips(margin, "left", 1440),
      right: twips(margin, "right", 1440),
      header: twips(margin, "header", 709),
      footer: twips(margin, "footer", 709),
    },
  };

  const band = (kind: "header" | "footer"): LetterheadBand => {
    const references = [...section.matchAll(new RegExp(`<(?:\\w+:)?${kind}Reference\\b([^>]*)\\/?>`, "g"))].map(
      (match) => ({ type: attribute(match[1] ?? "", "type") ?? "default", id: attribute(match[1] ?? "", "id") }),
    );
    const chosen = references.find((ref) => ref.type === "default") ?? references.find((ref) => ref.type === "first");
    const target = chosen?.id ? documentRels.get(chosen.id) : undefined;
    if (!target) return { lines: [], images: [] };
    const part = partOf(target);
    const xml = text(part);
    if (!xml) return { lines: [], images: [] };
    const name = part.split("/").pop()!;
    return readBand(xml, relationships(text(`word/_rels/${name}.rels`)));
  };
  const header = band("header");
  const footer = band("footer");
  if (header.lines.length + header.images.length + footer.lines.length + footer.images.length === 0) {
    return { ok: false, code: "no_letterhead" };
  }
  const media: Record<string, Uint8Array> = {};
  for (const image of [...header.images, ...footer.images]) {
    const bytesOf = files[image.part];
    if (bytesOf) media[image.part] = bytesOf;
  }
  // A picture whose bytes are not in the package is no picture of the letterhead.
  const kept = (images: LetterheadImage[]) => images.filter((image) => media[image.part]);
  return {
    ok: true,
    page,
    header: { lines: header.lines, images: kept(header.images) },
    footer: { lines: footer.lines, images: kept(footer.images) },
    font: fontOf(text("word/styles.xml"), text("word/theme/theme1.xml")),
    media,
  };
}

// ---------- Writing on the letterhead ----------

export type LetterheadBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; indent?: boolean };

const carried = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  return code >= 0x20 && code !== 0xfffe && code !== 0xffff && (code < 0xd800 || code > 0xdfff);
};

const escapeXml = (text: string): string =>
  Array.from(text).filter(carried).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function runOf(text: string, bold: boolean): string {
  const parts: string[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (index > 0) parts.push("<w:br/>");
      const written = escapeXml(line);
      if (written !== "") parts.push(`<w:t xml:space="preserve">${written}</w:t>`);
    });
  return parts.length > 0 ? `<w:r>${bold ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : ""}${parts.join("")}</w:r>` : "";
}

/** A block as a paragraph of the firm's document: its own fonts and styles, a heading in bold kept with what follows. */
function paragraphXml(block: LetterheadBlock): string {
  if (block.kind === "title") {
    return `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr>${runOf(block.text, true)}</w:p>`;
  }
  if (block.kind === "heading") {
    return `<w:p><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/></w:pPr>${runOf(block.text, true)}</w:p>`;
  }
  const properties = block.indent
    ? '<w:pPr><w:ind w:firstLine="709"/><w:jc w:val="both"/></w:pPr>'
    : '<w:pPr><w:jc w:val="both"/></w:pPr>';
  return `<w:p>${properties}${runOf(block.text, false)}</w:p>`;
}

/** Every part of a package is dated the same: the same text is the same file. */
const PACKAGE_DATE = "2026-01-01T00:00:00";

/**
 * The firm's own document with its body replaced by the blocks: the last section's properties stay (the page, the
 * margins, the header and the footer), and every other part as the firm wrote it. Null when the bytes are no Word
 * document whose body can be found.
 */
export function writeDocxOnLetterhead(template: Uint8Array, blocks: readonly LetterheadBlock[]): Uint8Array | null {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(template);
  } catch {
    return null;
  }
  const source = files["word/document.xml"];
  if (!source) return null;
  const document = strFromU8(source);
  const opening = /<(\w+:)?body\b[^>]*>/.exec(document);
  const closing = document.lastIndexOf(`</${opening?.[1] ?? ""}body>`);
  if (!opening || closing < 0) return null;
  const inside = document.slice(opening.index + opening[0].length, closing);
  const section = [...inside.matchAll(/<(?:\w+:)?sectPr\b[\s\S]*?<\/(?:\w+:)?sectPr>/g)].at(-1)?.[0] ?? "";
  const body = (blocks.length > 0 ? blocks.map(paragraphXml).join("") : "<w:p/>") + section;
  // A document whose prefix for Word's names is not `w` still names them so: the blocks are written with `w`.
  const declaresW = /xmlns:w\s*=/.test(document.slice(0, opening.index));
  if (!declaresW) return null;
  files["word/document.xml"] = strToU8(
    document.slice(0, opening.index + opening[0].length) + body + document.slice(closing),
  );
  return zipSync(files, { level: 6, mtime: PACKAGE_DATE });
}
