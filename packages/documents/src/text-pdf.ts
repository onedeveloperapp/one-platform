import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import { A4 } from "@flyee/documents/normalize";
import { STAMP_BAND } from "@flyee/documents/stamp";

/**
 * A document of text as a PDF: what ONE writes itself (a dossier of a case)
 * or lays out for a firm (the piece a lawyer approved), on A4 pages with the
 * foot of each page left free for the verification mark
 * (`stampVerification`) of the documents that take one. A piece of a
 * lawsuit takes none, and says nothing of the platform: it is the firm's
 * (`producer`).
 *
 * It is a plain layout on purpose: a title, headings, paragraphs, lists and
 * pairs of label and value, wrapped by the measure of each word. The standard
 * fonts of a PDF are used, so nothing is downloaded and the same input gives
 * the same pages; they write Latin text, and a character outside it is
 * replaced by its nearest plain form or left out instead of stopping the
 * document.
 */

export type TextBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; indent?: boolean }
  | { kind: "list"; items: string[]; ordered?: boolean }
  /** Pairs of a label and its value, one per line: "CPF: 123...". */
  | { kind: "fields"; rows: { label: string; value: string }[] }
  | { kind: "space"; points?: number }
  | { kind: "pageBreak" };

export interface TextDocument {
  blocks: TextBlock[];
  /** A line at the top of every page: whose document it is. */
  header?: string;
  /** Writes "n / total" at the top right of every page. */
  pageNumbers?: boolean;
  /** Metadata of the file. */
  title?: string;
  author?: string;
  /**
   * What the file says made it. ONE, for what ONE issues; the firm, for a piece of its own that goes to a
   * court: nothing in such a file names the platform.
   */
  producer?: string;
}

const MARGIN_X = 62;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = STAMP_BAND + 24;
const HEADER_SIZE = 8;
const SIZES = { title: 15, heading: 11.5, body: 10.5 } as const;
const LEADING = 1.42;
const INDENT = 28;
const LIST_INDENT = 16;

/**
 * The typographic characters people paste, by their codes, as the plain ones the standard fonts write:
 * curly and low quotes and the primes, every hyphen and dash and the minus sign, the bullet, the ellipsis,
 * the ligatures a PDF copies as one character, the spaces that are not the plain one, and what has no
 * width at all. Whatever is not here and is not Latin-1 has no plain form: `unwritableCharacters` names
 * it, and the database refuses to approve a piece that holds one (`unwritable_characters`, migration
 * 0029, which lists the same codes).
 */
const PLAIN = new Map<number, string>([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201a, "'"],
  [0x2032, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x2033, '"'],
  [0x2010, "-"],
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2013, "-"],
  [0x2014, "-"],
  [0x2015, "-"],
  [0x2212, "-"],
  [0x2022, "-"],
  [0x2026, "..."],
  [0xfb00, "ff"],
  [0xfb01, "fi"],
  [0xfb02, "fl"],
  [0xfb03, "ffi"],
  [0xfb04, "ffl"],
  [0x00a0, " "],
  [0x202f, " "],
  [0x2002, " "],
  [0x2003, " "],
  [0x2007, " "],
  [0x2009, " "],
  [0x0009, " "],
  [0x000d, ""],
  [0x00ad, ""],
  [0x200b, ""],
  [0x200c, ""],
  [0x200d, ""],
  [0xfeff, ""],
]);

/** The codes written in a plain form: what a text may hold beyond Latin-1. */
export const PLAIN_CODES: readonly number[] = [...PLAIN.keys()];

/** A character the standard fonts write: Latin-1, with no control character of either range. */
const isWritable = (unit: string): boolean =>
  unit === "\n" || (unit >= " " && unit <= "ÿ" && !(unit >= "\u007f" && unit <= "\u009f"));

/** Text the standard fonts can write: Latin-1, with what people paste brought to its plain form. */
export function writableText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const plain = PLAIN.get(char.codePointAt(0) ?? 0) ?? char;
    for (const unit of plain) {
      if (isWritable(unit)) out += unit;
    }
  }
  return out;
}

/**
 * The characters of a text `writableText` would leave out: what a document made of it could not say. Each
 * once, in the order they appear, twenty at most. A text that holds none is written whole.
 */
export function unwritableCharacters(text: string): string[] {
  const found: string[] = [];
  for (const char of text.normalize("NFC")) {
    const plain = PLAIN.get(char.codePointAt(0) ?? 0);
    if (plain !== undefined || isWritable(char) || found.includes(char)) continue;
    found.push(char);
    if (found.length === 20) break;
  }
  return found;
}

/** No line holds more characters than this, however narrow they are: what bounds the measure of a long word. */
const MOST_IN_A_LINE = 1000;

/** Breaks a text into the lines that fit a width, by the measure of its words. A word wider than the line is cut. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      let rest = word;
      // A single word wider than the line (an address, a hash) is cut where it stops fitting. Only its start
      // is measured, and the place is found by halving: a word of any length is cut in the time of its length.
      while (font.widthOfTextAtSize(rest.slice(0, MOST_IN_A_LINE), size) > width) {
        let cut = 1;
        for (let most = Math.min(rest.length, MOST_IN_A_LINE); cut < most; ) {
          const middle = (cut + most + 1) >> 1;
          if (font.widthOfTextAtSize(rest.slice(0, middle), size) <= width) cut = middle;
          else most = middle - 1;
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      const candidate = line ? `${line} ${rest}` : rest;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderTextPdf(document: TextDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  if (document.title) pdf.setTitle(writableText(document.title));
  if (document.author) pdf.setAuthor(writableText(document.author));
  // The same input gives the same bytes: no clock in the file.
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const producer = writableText(document.producer ?? "").trim() || "ONE";
  pdf.setProducer(producer);
  pdf.setCreator(producer);

  const width = A4.width - MARGIN_X * 2;
  const ink = rgb(0.1, 0.1, 0.12);
  const soft = rgb(0.38, 0.38, 0.42);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    y = A4.height - MARGIN_TOP;
  };
  /** Makes sure `needed` points fit above the foot; a new page otherwise. */
  const room = (needed: number) => {
    if (y - needed < MARGIN_BOTTOM) newPage();
  };
  const write = (text: string, font: PDFFont, size: number, x: number, color = ink) => {
    page.drawText(text, { x, y: y - size, size, font, color });
  };
  const lines = (text: string, font: PDFFont, size: number, x: number, firstIndent = 0) => {
    const step = size * LEADING;
    const wrapped = wrapText(writableText(text), font, size, width - (x - MARGIN_X) - firstIndent);
    wrapped.forEach((line, index) => {
      room(step);
      // Only the first line of a paragraph is set in: the others were wrapped a little short, which is fine.
      write(line, font, size, x + (index === 0 ? firstIndent : 0));
      y -= step;
    });
  };

  newPage();
  for (const block of document.blocks) {
    if (block.kind === "pageBreak") {
      newPage();
    } else if (block.kind === "space") {
      y -= block.points ?? SIZES.body;
    } else if (block.kind === "title") {
      room(SIZES.title * LEADING * 2);
      lines(block.text, bold, SIZES.title, MARGIN_X);
      y -= SIZES.body * 0.6;
    } else if (block.kind === "heading") {
      // A heading never stays alone at the foot of a page: it goes with at least two lines of what follows.
      room(SIZES.heading * LEADING + SIZES.body * LEADING * 2 + SIZES.body);
      y -= SIZES.body * 0.7;
      lines(block.text, bold, SIZES.heading, MARGIN_X);
      y -= SIZES.body * 0.25;
    } else if (block.kind === "paragraph") {
      lines(block.text, regular, SIZES.body, MARGIN_X, block.indent ? INDENT : 0);
      y -= SIZES.body * 0.45;
    } else if (block.kind === "list") {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${index + 1}.` : "-";
        room(SIZES.body * LEADING);
        write(marker, regular, SIZES.body, MARGIN_X);
        lines(item, regular, SIZES.body, MARGIN_X + LIST_INDENT);
      });
      y -= SIZES.body * 0.45;
    } else {
      for (const row of block.rows) {
        const label = `${writableText(row.label)}: `;
        const labelWidth = bold.widthOfTextAtSize(label, SIZES.body);
        room(SIZES.body * LEADING);
        write(label, bold, SIZES.body, MARGIN_X);
        // The value follows its label on the same line when the label is short; under it otherwise.
        if (labelWidth < width * 0.45) {
          lines(row.value, regular, SIZES.body, MARGIN_X + labelWidth);
        } else {
          y -= SIZES.body * LEADING;
          lines(row.value, regular, SIZES.body, MARGIN_X + LIST_INDENT);
        }
      }
      y -= SIZES.body * 0.45;
    }
  }

  const header = document.header ? writableText(document.header) : "";
  pages.forEach((sheet, index) => {
    const top = A4.height - MARGIN_TOP + 22;
    if (header) {
      const fitted = wrapText(header, regular, HEADER_SIZE, width - 60)[0] ?? "";
      sheet.drawText(fitted, { x: MARGIN_X, y: top, size: HEADER_SIZE, font: regular, color: soft });
    }
    if (document.pageNumbers) {
      const label = `${index + 1} / ${pages.length}`;
      sheet.drawText(label, {
        x: A4.width - MARGIN_X - regular.widthOfTextAtSize(label, HEADER_SIZE),
        y: top,
        size: HEADER_SIZE,
        font: regular,
        color: soft,
      });
    }
  });

  return pdf.save();
}
