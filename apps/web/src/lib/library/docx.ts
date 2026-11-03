import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import { draftBlocks } from "@/lib/cases/drafts";

/**
 * The text of a Word document (.docx), paragraph by paragraph, as the page
 * shows it: what the library makes a model of (migration 0067). Pure but for
 * the unzipping: no I/O, no clock. The other way, `writeDocx` writes a text
 * as a Word document the firm downloads (a model of the library, the paper a
 * client signs), which this reader reads back as it was written.
 *
 * A .docx is a zip of XML parts. Only the parts that hold the text are
 * unpacked (the body, the lists' numbering, the footnotes and the endnotes),
 * within a ceiling, and the text is read from its marks:
 *
 * - a paragraph is what Word shows of it: its runs, a tab as a space, a line
 *   break inside it as a line of its own;
 * - a paragraph of a list starts with the number or letter the list gives it
 *   ("a)", "1.", "IV -"), which Word writes and the text does not hold;
 * - a table is a paragraph per row, its cells separated by " | ";
 * - a footnote or an endnote is called where it is by its number in brackets
 *   ("[1]") and written at the end, after a paragraph "NOTAS".
 *
 * What the page does not show is left out: text deleted with the changes
 * tracked, hidden text, the code of a field (its result stays), the header
 * and the footer (the firm's letterhead), text boxes and drawings, comments.
 * The elements are read by their names with or without a namespace's prefix.
 */

/** The most the parts read may unpack to: the text of a petition is a few hundred kilobytes. */
const MOST_UNPACKED = 30 * 1024 * 1024;

const BODY = "word/document.xml";
const PARTS = new Set([BODY, "word/numbering.xml", "word/footnotes.xml", "word/endnotes.xml"]);

export type DocxText = { ok: true; paragraphs: string[] } | { ok: false; code: "not_docx" | "too_large" };

/** What the page does not show, or shows apart from the text: never read. */
const SKIPPED = new Set([
  "del",
  "moveFrom",
  "drawing",
  "pict",
  "object",
  "Fallback",
  "txbxContent",
  "sectPr",
  "footnoteRef",
  "endnoteRef",
  "annotationRef",
]);

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[entity] ?? whole;
  });

type Token =
  | { kind: "open"; name: string; attributes: string; closed: boolean }
  | { kind: "close"; name: string }
  | { kind: "text"; text: string };

/** The marks and the text of an XML part, in order: a name without its namespace's prefix. */
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

/** The value of an attribute, with or without its prefix (`w:val`, `val`). */
function attribute(attributes: string, name: string): string | null {
  const found = new RegExp(`(?:^|\\s)(?:[A-Za-z_][\\w.-]*:)?${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(attributes);
  return found ? decode(found[2] ?? found[3] ?? "") : null;
}

const isOff = (value: string | null): boolean => value === "0" || value === "false" || value === "off";

// ---------- Lists ----------

type Level = { format: string; text: string; start: number; legal: boolean; suffix: string };

/** How each list of the document numbers its paragraphs, by the list's id. */
type Numbering = Map<string, { levels: Map<number, Level>; starts: Map<number, number> }>;

function readNumbering(xml: string | null): Numbering {
  const abstract = new Map<string, Map<number, Level>>();
  const lists = new Map<string, { abstractId: string; starts: Map<number, number> }>();
  if (!xml) return new Map();
  let abstractId: string | null = null;
  let level: (Level & { index: number }) | null = null;
  let listId: string | null = null;
  let overrideLevel: number | null = null;
  const stack: string[] = [];
  for (const token of tokens(xml)) {
    if (token.kind === "text") continue;
    if (token.kind === "close") {
      stack.pop();
      if (token.name === "lvl" && level && abstractId !== null && stack.at(-1) === "abstractNum") {
        abstract.get(abstractId)?.set(level.index, level);
        level = null;
      } else if (token.name === "abstractNum") abstractId = null;
      else if (token.name === "num") listId = null;
      else if (token.name === "lvlOverride") overrideLevel = null;
      continue;
    }
    const value = attribute(token.attributes, "val");
    const parent = stack.at(-1);
    if (token.name === "abstractNum") {
      abstractId = attribute(token.attributes, "abstractNumId");
      if (abstractId !== null) abstract.set(abstractId, new Map());
    } else if (token.name === "lvl" && parent === "abstractNum") {
      const index = Number(attribute(token.attributes, "ilvl") ?? "0");
      level = { index, format: "decimal", text: "", start: 1, legal: false, suffix: "tab" };
    } else if (level && parent === "lvl") {
      if (token.name === "numFmt") level.format = value ?? "decimal";
      else if (token.name === "lvlText") level.text = value ?? "";
      else if (token.name === "start") level.start = Number(value ?? "1") || 0;
      else if (token.name === "isLgl") level.legal = !isOff(value);
      else if (token.name === "suff") level.suffix = value ?? "tab";
    } else if (token.name === "num" && parent !== "lvl") {
      listId = attribute(token.attributes, "numId");
      if (listId !== null) lists.set(listId, { abstractId: "", starts: new Map() });
    } else if (listId !== null && token.name === "abstractNumId" && parent === "num") {
      const list = lists.get(listId);
      if (list) list.abstractId = value ?? "";
    } else if (listId !== null && token.name === "lvlOverride") {
      overrideLevel = Number(attribute(token.attributes, "ilvl") ?? "0");
    } else if (listId !== null && overrideLevel !== null && token.name === "startOverride") {
      lists.get(listId)?.starts.set(overrideLevel, Number(value ?? "1") || 0);
    }
    if (!token.closed) stack.push(token.name);
  }
  const numbering: Numbering = new Map();
  for (const [id, list] of lists) {
    const levels = abstract.get(list.abstractId);
    if (levels) numbering.set(id, { levels, starts: list.starts });
  }
  return numbering;
}

const ROMAN: [number, string][] = [
  [1000, "m"],
  [900, "cm"],
  [500, "d"],
  [400, "cd"],
  [100, "c"],
  [90, "xc"],
  [50, "l"],
  [40, "xl"],
  [10, "x"],
  [9, "ix"],
  [5, "v"],
  [4, "iv"],
  [1, "i"],
];

function roman(value: number): string {
  let left = value;
  let out = "";
  for (const [size, letters] of ROMAN) {
    while (left >= size) {
      out += letters;
      left -= size;
    }
  }
  return out;
}

/** A letter as Word counts with letters: a to z, then aa, bb and so on. */
const letter = (value: number): string =>
  String.fromCharCode(97 + ((value - 1) % 26)).repeat(Math.floor((value - 1) / 26) + 1);

/** A count as a level of a list writes it. */
function counted(value: number, format: string): string {
  if (value <= 0) return String(value);
  switch (format) {
    case "lowerLetter":
      return letter(value);
    case "upperLetter":
      return letter(value).toUpperCase();
    case "lowerRoman":
      return roman(value);
    case "upperRoman":
      return roman(value).toUpperCase();
    case "decimalZero":
      return value < 10 ? `0${value}` : String(value);
    case "ordinal":
      return `${value}º`;
    case "none":
      return "";
    default:
      return String(value);
  }
}

/** Where each list of the document is, level by level. */
type Counters = Map<string, (number | null)[]>;

/** What a list writes before a paragraph of a level of it: its number or letter, and what follows it. */
function label(numbering: Numbering, counters: Counters, listId: string, levelIndex: number): string {
  const list = numbering.get(listId);
  const level = list?.levels.get(levelIndex);
  if (!list || !level) return "";
  const startOf = (index: number) => list.starts.get(index) ?? list.levels.get(index)?.start ?? 1;
  const count = counters.get(listId) ?? Array<number | null>(9).fill(null);
  counters.set(listId, count);
  count[levelIndex] = count[levelIndex] === null ? startOf(levelIndex) : (count[levelIndex] ?? 0) + 1;
  for (let deeper = levelIndex + 1; deeper < count.length; deeper += 1) count[deeper] = null;
  for (let above = 0; above < levelIndex; above += 1) if (count[above] === null) count[above] = startOf(above);
  if (level.format === "bullet") return "•";
  const written = level.text.replace(/%([1-9])/g, (_, at: string) => {
    const index = Number(at) - 1;
    const format = level.legal ? "decimal" : (list.levels.get(index)?.format ?? "decimal");
    return counted(count[index] ?? startOf(index), format);
  });
  return written.trim();
}

// ---------- The text ----------

type Paragraph = { text: string; listId: string | null; level: number };
type Table = { rows: string[]; row: string[] | null; cell: string[] | null };

/** A line as the page shows it: every kind of space and a tab as one plain space, none twice, none at its ends. */
const tidyLine = (line: string): string => line.replace(/\s+/g, " ").trim();

const tidy = (text: string): string =>
  text
    .split("\n")
    .map(tidyLine)
    .filter((line) => line !== "")
    .join("\n");

/**
 * The paragraphs of a part: the body, or one note of the notes. `onNote` is told each note the text calls, in
 * order, and answers the number it is written with.
 */
function readParagraphs(
  xml: string,
  numbering: Numbering,
  onNote: (kind: "footnote" | "endnote", id: string) => number,
): string[] {
  const paragraphs: string[] = [];
  const counters: Counters = new Map();
  const stack: string[] = [];
  const tables: Table[] = [];
  let skipped = 0;
  let current: Paragraph | null = null;
  let hidden = false;
  let inText = false;

  const emit = (text: string) => {
    const table = tables.at(-1);
    if (table?.cell) table.cell.push(text);
    else if (text !== "") paragraphs.push(text);
  };

  for (const token of tokens(xml)) {
    if (token.kind === "text") {
      if (skipped === 0 && inText && current && !hidden) current.text += token.text;
      continue;
    }
    if (token.kind === "close") {
      const name = stack.pop();
      if (name !== undefined && SKIPPED.has(name)) skipped -= 1;
      if (skipped > 0) continue;
      if (token.name === "t") inText = false;
      else if (token.name === "r") hidden = false;
      else if (token.name === "p" && current) {
        let text = tidy(current.text);
        // An item of a list is counted as Word counts it, an empty one too; only one with text is written.
        if (current.listId !== null && current.listId !== "0") {
          const written = label(numbering, counters, current.listId, current.level);
          if (written && text !== "") text = `${written} ${text}`;
        }
        current = null;
        emit(text);
      } else if (token.name === "tc") {
        const table = tables.at(-1);
        if (table?.cell && table.row) table.row.push(table.cell.join(" "));
        if (table) table.cell = null;
      } else if (token.name === "tr") {
        const table = tables.at(-1);
        const cells = (table?.row ?? []).map(tidyLine).filter(Boolean);
        if (table) {
          table.row = null;
          if (cells.length > 0) table.rows.push(cells.join(" | "));
        }
      } else if (token.name === "tbl") {
        const table = tables.pop();
        // A table inside a cell of another stays in that cell.
        for (const row of table?.rows ?? []) emit(row);
      }
      continue;
    }

    // An element that closes itself is never on the stack: only one with a body is.
    const parent = stack.at(-1);
    const grandparent = stack.at(-2);
    if (!token.closed) stack.push(token.name);
    if (SKIPPED.has(token.name)) {
      if (!token.closed) skipped += 1;
      continue;
    }
    if (skipped > 0) continue;
    switch (token.name) {
      case "p":
        // An empty paragraph that closes itself is a space on the page, never a paragraph of the text.
        current = token.closed ? null : { text: "", listId: null, level: 0 };
        break;
      case "tbl":
        tables.push({ rows: [], row: null, cell: null });
        break;
      case "tr":
        if (tables.at(-1)) tables.at(-1)!.row = [];
        break;
      case "tc":
        if (tables.at(-1)) tables.at(-1)!.cell = [];
        break;
      case "numId":
        if (current && parent === "numPr") current.listId = attribute(token.attributes, "val");
        break;
      case "ilvl":
        if (current && parent === "numPr") current.level = Math.min(Number(attribute(token.attributes, "val")) || 0, 8);
        break;
      case "r":
        hidden = false;
        break;
      case "vanish":
        // Hidden text of a run; the same mark in a paragraph's properties hides only its end.
        if (parent === "rPr" && grandparent === "r") hidden = !isOff(attribute(token.attributes, "val"));
        break;
      case "t":
        inText = !token.closed;
        break;
      default:
        if (!current || hidden || parent !== "r") break;
        if (token.name === "tab") current.text += " ";
        else if (token.name === "br") {
          const type = attribute(token.attributes, "type");
          if (type !== "page" && type !== "column") current.text += "\n";
        } else if (token.name === "cr") current.text += "\n";
        else if (token.name === "noBreakHyphen") current.text += "-";
        else if (token.name === "sym") {
          // A bullet of the Symbol font is the one character a text carries of it.
          const code = (attribute(token.attributes, "char") ?? "").toUpperCase();
          if (code === "F0B7" || code === "00B7") current.text += "•";
        } else if (token.name === "footnoteReference" || token.name === "endnoteReference") {
          const id = attribute(token.attributes, "id");
          if (id !== null)
            current.text += `[${onNote(token.name === "footnoteReference" ? "footnote" : "endnote", id)}]`;
        }
    }
  }
  return paragraphs;
}

/** The notes of a part (footnotes or endnotes), each by its id, as one line of text. */
function readNotes(xml: string | null, kind: "footnote" | "endnote", numbering: Numbering): Map<string, string> {
  const notes = new Map<string, string>();
  if (!xml) return notes;
  // Each note is read as a part of its own: what separates the notes from the text on the page is no note.
  const note = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${kind}(\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${kind}>`,
    "g",
  );
  for (const match of xml.matchAll(note)) {
    const attributes = match[1] ?? "";
    const type = attribute(attributes, "type");
    const id = attribute(attributes, "id");
    if (id === null || (type !== null && type !== "normal")) continue;
    const text = readParagraphs(match[2], numbering, () => 0).join(" ");
    if (text !== "") notes.set(id, text);
  }
  return notes;
}

/** The paragraphs of a Word document, or why it could not be read. `mostUnpacked` is the ceiling, for a test. */
export function readDocx(bytes: Uint8Array, mostUnpacked = MOST_UNPACKED): DocxText {
  let files: Record<string, Uint8Array>;
  let unpacked = 0;
  let tooLarge = false;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!PARTS.has(file.name)) return false;
        unpacked += file.originalSize;
        if (unpacked > mostUnpacked) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch {
    return { ok: false, code: "not_docx" };
  }
  if (tooLarge) return { ok: false, code: "too_large" };
  const text = (name: string): string | null => (files[name] ? strFromU8(files[name]) : null);
  const body = text(BODY);
  if (body === null) return { ok: false, code: "not_docx" };

  const numbering = readNumbering(text("word/numbering.xml"));
  const footnotes = readNotes(text("word/footnotes.xml"), "footnote", numbering);
  const endnotes = readNotes(text("word/endnotes.xml"), "endnote", numbering);
  // Each note called is numbered in the order the text calls it, footnotes and endnotes alike.
  const called: string[] = [];
  const numbered = new Map<string, number>();
  const paragraphs = readParagraphs(body, numbering, (kind, id) => {
    const key = `${kind}:${id}`;
    const known = numbered.get(key);
    if (known !== undefined) return known;
    const note = (kind === "footnote" ? footnotes : endnotes).get(id) ?? "";
    called.push(note);
    numbered.set(key, called.length);
    return called.length;
  });
  if (called.some((note) => note !== "")) {
    paragraphs.push("NOTAS");
    called.forEach((note, index) => {
      if (note !== "") paragraphs.push(`[${index + 1}] ${note}`);
    });
  }
  return { ok: true, paragraphs };
}

// ---------- Writing ----------

/** A block of a Word document ONE writes: a heading, or a paragraph whose lines stay apart, as `draftBlocks` reads a text. */
export type DocxBlock = { kind: "heading"; text: string } | { kind: "paragraph"; text: string; indent?: boolean };

/** The type a browser is told a Word document is. */
export const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PACKAGE_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Every part of a package is dated the same: the same text is the same file. */
const PACKAGE_DATE = "2026-01-01T00:00:00";

/** A character XML 1.0 carries: the tab, the line feed, the carriage return and every other from the space on, never a lone half of a pair nor U+FFFE and U+FFFF. */
const carried = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  return code >= 0x20 && code !== 0xfffe && code !== 0xffff && (code < 0xd800 || code > 0xdfff);
};

const escapeXml = (text: string): string =>
  Array.from(text).filter(carried).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The run of a block's text: each line apart by a line break, each tab as Word's own. */
function runOf(text: string): string {
  const parts: string[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (index > 0) parts.push("<w:br/>");
      line.split("\t").forEach((piece, at) => {
        if (at > 0) parts.push("<w:tab/>");
        const written = escapeXml(piece);
        if (written !== "") parts.push(`<w:t xml:space="preserve">${written}</w:t>`);
      });
    });
  return parts.length > 0 ? `<w:r>${parts.join("")}</w:r>` : "";
}

function paragraphXml(block: DocxBlock): string {
  const properties =
    block.kind === "heading"
      ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
      : block.indent
        ? '<w:pPr><w:ind w:firstLine="709"/></w:pPr>'
        : "";
  return `<w:p>${properties}${runOf(block.text)}</w:p>`;
}

/**
 * The styles of the document: Arial 12 in Portuguese, justified, with a line and a half, as a petition is
 * usually written; a heading in bold, kept with what follows it.
 */
const STYLES = `${XML_HEAD}<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pt-BR" w:eastAsia="pt-BR" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="240" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:style></w:styles>`;

/**
 * A Word document (.docx) of blocks of text, on A4 pages with the margins of a petition (3 cm at the top and the
 * left, 2 cm at the right and the bottom): the parts Word needs and nothing else, so the file names nobody but what
 * its text says. Pure: the same blocks give the same bytes.
 */
export function writeDocx(blocks: readonly DocxBlock[]): Uint8Array {
  // Word wants a paragraph in a body, an empty one included.
  const body = blocks.length > 0 ? blocks.map(paragraphXml).join("") : "<w:p/>";
  const document = `${XML_HEAD}<w:document xmlns:w="${WORD_NS}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const files: Record<string, Uint8Array> = {
    // The list of the package's types comes first, as Word writes it.
    "[Content_Types].xml": strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_NS}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(document),
    "word/_rels/document.xml.rels": strToU8(
      `${XML_HEAD}<Relationships xmlns="${PACKAGE_NS}"><Relationship Id="rId1" Type="${OFFICE_NS}/styles" Target="styles.xml"/></Relationships>`,
    ),
    "word/styles.xml": strToU8(STYLES),
  };
  return zipSync(files, { level: 6, mtime: PACKAGE_DATE });
}

/** A mark the platform fills with the facts of a lawsuit or a client (`[[OUTORGANTE]]`). */
const MARK = /\[\[[A-Z_]+\]\]/g;

/**
 * A text of the library (a model, the paper a client signs, a clause) as a Word document, block by block as the
 * PDF of what it is filled into prints it (`draftBlocks`): a line all in capitals a heading, every other a
 * paragraph with its lines as they were written. A mark is filled with names and facts written in lower case, so
 * a line is told a heading as if its marks were ("OUTORGANTE: [[OUTORGANTE]]." is a paragraph of the document,
 * and here). The marks stay as they are: the file is the model, to be read, printed or changed in Word and sent
 * back as a model of the firm.
 */
export function textDocx(text: string): Uint8Array {
  const blocks = draftBlocks(text);
  // The same blocks, in the same order: only the case of the marks differs, never a line or a blank one.
  const filled = draftBlocks(text.replace(MARK, (mark) => mark.toLowerCase()));
  return writeDocx(
    blocks.flatMap((block, index): DocxBlock[] => {
      if (block.kind !== "heading" && block.kind !== "paragraph") return [];
      const shape = filled[index];
      if (shape?.kind === "heading") return [{ kind: "heading", text: block.text }];
      return [{ kind: "paragraph", text: block.text, indent: shape?.kind === "paragraph" && shape.indent === true }];
    }),
  );
}
