import { type PDFEmbeddedPage, type PDFFont, type PDFImage, PDFDocument, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import type { Band, PdfLetterhead } from "@flyee/documents/letterhead";
import { A4 } from "@flyee/documents/normalize";
import { wrapText, writableText } from "@flyee/documents/pdf-text";
import { STAMP_BAND } from "@flyee/documents/stamp";

export { PLAIN_CODES, unwritableCharacters, wrapText, writableText } from "@flyee/documents/pdf-text";

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
  /** The firm's letterhead (0260): its blank page under every page, or its header and footer on every page. */
  letterhead?: PdfLetterhead | null;
  /** The document takes ONE's verification mark: its band is kept free above the letterhead's footer. */
  stamped?: boolean;
}

/** Where the text goes on a page, and where the verification mark is drawn: above the letterhead's footer. */
export type PageLayout = { top: number; bottom: number; left: number; right: number; stampAt: number };

const BAND_GAP = 4;
const LINE_STEP = 1.3;

/** How tall a header or a footer is, as `drawBand` draws it within a width. */
function bandHeight(band: Band, width: number): number {
  let height = 0;
  for (const image of band.images) height += Math.min(image.heightPt, (image.heightPt * width) / image.widthPt) + BAND_GAP;
  for (const line of band.lines) height += line.sizePt * LINE_STEP;
  return height;
}

/**
 * The layout of the pages of the document, with or without the firm's letterhead: of its first page and of the
 * others, where the firm's paper has a first page of its own. The verification mark is drawn at the same height on
 * every page, above the higher of the two footers.
 */
export function pageLayouts(
  letterhead: PdfLetterhead | null | undefined,
  stamped = true,
): { first: PageLayout; rest: PageLayout } {
  const rest = singleLayout(letterhead, stamped);
  if (letterhead?.kind !== "page" || !letterhead.first) return { first: rest, rest };
  const first = singleLayout({ ...letterhead, margins: letterhead.first.margins }, stamped);
  const stampAt = Math.max(first.stampAt, rest.stampAt);
  const lifted = (layout: PageLayout) => ({
    ...layout,
    stampAt,
    bottom: stamped ? Math.max(layout.bottom, stampAt - 2 + STAMP_BAND + 10) : layout.bottom,
  });
  return { first: lifted(first), rest: lifted(rest) };
}

/** The layout of a page of the document, with or without the firm's letterhead: the pages after the first. */
export function pageLayout(letterhead: PdfLetterhead | null | undefined, stamped = true): PageLayout {
  return pageLayouts(letterhead, stamped).rest;
}

function singleLayout(letterhead: PdfLetterhead | null | undefined, stamped: boolean): PageLayout {
  if (!letterhead) {
    return { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X, stampAt: 0 };
  }
  const margins = letterhead.margins;
  const width = A4.width - margins.left - margins.right;
  let top: number;
  let footerTop: number;
  let bottom: number;
  if (letterhead.kind === "page") {
    top = margins.top;
    // The measure keeps 14 points between the footer and the text.
    footerTop = Math.max(0, margins.bottom - 14);
    bottom = margins.bottom;
  } else {
    const bands = letterhead.margins;
    top = Math.max(bands.top, bands.header + bandHeight(letterhead.header, width) + 14);
    footerTop = bands.footer + bandHeight(letterhead.footer, width);
    bottom = Math.max(bands.bottom, footerTop + 14);
  }
  if (stamped) bottom = Math.max(bottom, footerTop + STAMP_BAND + 10);
  return { top, bottom, left: margins.left, right: margins.right, stampAt: stamped ? footerTop + 2 : 0 };
}

const MARGIN_X = 62;
const MARGIN_TOP = 64;
const MARGIN_BOTTOM = STAMP_BAND + 24;
const HEADER_SIZE = 8;
const SIZES = { title: 15, heading: 11.5, body: 10.5 } as const;
const LEADING = 1.42;
const INDENT = 28;
const LIST_INDENT = 16;

export async function renderTextPdf(document: TextDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const letterhead = document.letterhead ?? null;
  const layouts = pageLayouts(letterhead, document.stamped !== false);
  const layout = layouts.rest;
  const MARGIN_X = layout.left;
  // Where the text goes on the page being written: the first page may have a header of its own.
  let MARGIN_TOP = layouts.first.top;
  let MARGIN_BOTTOM = layouts.first.bottom;
  // The firm's paper, drawn under each page (its first page under the first); or the pictures of its header and
  // footer, embedded once.
  let paper: PDFEmbeddedPage | null = null;
  let firstPaper: PDFEmbeddedPage | null = null;
  const pictures = new Map<Uint8Array, PDFImage>();
  if (letterhead?.kind === "page") {
    const restIndex = letterhead.page ?? 0;
    const firstIndex = letterhead.first?.page ?? restIndex;
    const embedded = await pdf.embedPdf(letterhead.pdf, firstIndex === restIndex ? [restIndex] : [firstIndex, restIndex]);
    firstPaper = embedded[0] ?? null;
    paper = embedded[embedded.length - 1] ?? null;
  } else if (letterhead?.kind === "bands") {
    for (const image of [...letterhead.header.images, ...letterhead.footer.images]) {
      if (pictures.has(image.bytes)) continue;
      pictures.set(image.bytes, image.mime === "image/png" ? await pdf.embedPng(image.bytes) : await pdf.embedJpg(image.bytes));
    }
  }
  if (document.title) pdf.setTitle(writableText(document.title));
  if (document.author) pdf.setAuthor(writableText(document.author));
  // The same input gives the same bytes: no clock in the file.
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const producer = writableText(document.producer ?? "").trim() || "ONE";
  pdf.setProducer(producer);
  pdf.setCreator(producer);

  const width = A4.width - layout.left - layout.right;
  const ink = rgb(0.1, 0.1, 0.12);
  const soft = rgb(0.38, 0.38, 0.42);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    const first = pages.length === 0;
    const under = first ? firstPaper : paper;
    if (under) page.drawPage(under, { x: 0, y: 0, width: A4.width, height: A4.height });
    MARGIN_TOP = first ? layouts.first.top : layout.top;
    MARGIN_BOTTOM = first ? layouts.first.bottom : layout.bottom;
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

  /** A header or a footer of the firm's Word letterhead, from its top down. */
  const drawBand = (sheet: PDFPage, band: Band, top: number) => {
    let cursor = top;
    const xOf = (align: "left" | "center" | "right", wide: number) =>
      align === "center" ? layout.left + (width - wide) / 2 : align === "right" ? A4.width - layout.right - wide : layout.left;
    for (const image of band.images) {
      const picture = pictures.get(image.bytes);
      if (!picture) continue;
      const scale = Math.min(1, width / image.widthPt);
      const wide = image.widthPt * scale;
      const tall = image.heightPt * scale;
      sheet.drawImage(picture, { x: xOf(image.align, wide), y: cursor - tall, width: wide, height: tall });
      cursor -= tall + BAND_GAP;
    }
    for (const line of band.lines) {
      const font = line.bold ? bold : regular;
      const text = wrapText(writableText(line.text), font, line.sizePt, width)[0] ?? "";
      sheet.drawText(text, {
        x: xOf(line.align, font.widthOfTextAtSize(text, line.sizePt)),
        y: cursor - line.sizePt,
        size: line.sizePt,
        font,
        color: ink,
      });
      cursor -= line.sizePt * LINE_STEP;
    }
  };

  const header = document.header ? writableText(document.header) : "";
  pages.forEach((sheet, index) => {
    if (letterhead?.kind === "bands") {
      drawBand(sheet, letterhead.header, A4.height - letterhead.margins.header);
      drawBand(sheet, letterhead.footer, letterhead.margins.footer + bandHeight(letterhead.footer, width));
    }
    const top = A4.height - (index === 0 ? layouts.first.top : layout.top) + 22;
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
