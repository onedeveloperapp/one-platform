import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";

import { closestText, wrapText } from "@flyee/documents/pdf-text";

/**
 * A table as a PDF, to read or to print: A4 lying down, a title and what the list is on the first page, the titles
 * of the columns repeated on every page and the number of each page. Pure, and it needs nothing of a server, so it
 * runs in the person's browser. The project's own, with no paid component.
 *
 * Nothing of a row is cut: a cell wraps as far as it needs, a row stays whole on its page, and only a row taller than
 * a page goes on over the next. The standard fonts of a PDF are used, so nothing is downloaded; they write Latin text,
 * and a letter outside it keeps its base letter (`closestText`).
 */

/** A piece of a cell, on a line of its own: `strong` in bold, `soft` in grey. */
export type TablePiece = { text: string; strong?: boolean; soft?: boolean };

/** A cell: its text, its pieces, or nothing. */
export type TableCell = string | TablePiece[] | null;

/** A column: its title and its share of the page's width, against the other columns' shares. */
export type TableColumn = { title: string; share: number };

export interface TableDocument {
  title: string;
  /** What the list is, a line each, under the title on the first page. */
  facts?: string[];
  columns: TableColumn[];
  rows: TableCell[][];
  author?: string;
  /** What the file says made it. */
  producer?: string;
  /** The moment the file says it was made; none keeps the same input giving the same bytes. */
  madeAt?: Date;
}

/** A4 lying down, in points. */
const PAGE = { width: 841.89, height: 595.28 } as const;
const MARGIN = { x: 32, top: 42, bottom: 28 } as const;
const SIZE = { title: 14, fact: 8.5, head: 7.5, cell: 8, running: 7.5 } as const;
const LEADING = 1.28;
/** Between a cell's words and its edges. */
const PAD = { x: 4, y: 4 } as const;

const INK = rgb(0.1, 0.1, 0.12);
const SOFT = rgb(0.38, 0.38, 0.42);
const RULE = rgb(0.84, 0.85, 0.87);
const HEAD_TINT = rgb(0.94, 0.95, 0.96);

type DrawnLine = { text: string; font: PDFFont; soft: boolean };

export async function writeTablePdf(document: TableDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(closestText(document.title));
  if (document.author) pdf.setAuthor(closestText(document.author));
  const producer = closestText(document.producer ?? "").trim() || "ONE";
  pdf.setProducer(producer);
  pdf.setCreator(producer);
  pdf.setCreationDate(document.madeAt ?? new Date(0));
  pdf.setModificationDate(document.madeAt ?? new Date(0));
  pdf.setLanguage("pt-BR");

  const width = PAGE.width - MARGIN.x * 2;
  const shares = document.columns.reduce((sum, column) => sum + column.share, 0) || 1;
  const widths = document.columns.map((column) => (column.share / shares) * width);
  const lefts = widths.map((_, index) => MARGIN.x + widths.slice(0, index).reduce((sum, item) => sum + item, 0));

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const lineHeight = (size: number) => size * LEADING;
  const headLines = document.columns.map((column, index) =>
    wrapText(closestText(column.title), bold, SIZE.head, widths[index] - PAD.x * 2),
  );
  const headHeight = Math.max(1, ...headLines.map((lines) => lines.length)) * lineHeight(SIZE.head) + PAD.y * 2;

  const drawHead = () => {
    page.drawRectangle({ x: MARGIN.x, y: y - headHeight, width, height: headHeight, color: HEAD_TINT });
    headLines.forEach((lines, index) => {
      lines.forEach((line, at) => {
        page.drawText(line, {
          x: lefts[index] + PAD.x,
          y: y - PAD.y - SIZE.head - at * lineHeight(SIZE.head),
          size: SIZE.head,
          font: bold,
          color: INK,
        });
      });
    });
    y -= headHeight;
  };

  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = PAGE.height - MARGIN.top;
  };

  // The first page opens on the title and on what the list is.
  newPage();
  for (const line of wrapText(closestText(document.title), bold, SIZE.title, width)) {
    page.drawText(line, { x: MARGIN.x, y: y - SIZE.title, size: SIZE.title, font: bold, color: INK });
    y -= lineHeight(SIZE.title);
  }
  y -= 2;
  for (const fact of document.facts ?? []) {
    for (const line of wrapText(closestText(fact), regular, SIZE.fact, width)) {
      page.drawText(line, { x: MARGIN.x, y: y - SIZE.fact, size: SIZE.fact, font: regular, color: SOFT });
      y -= lineHeight(SIZE.fact);
    }
  }
  y -= 8;
  drawHead();

  /** How many lines of a cell fit on a page under the titles: a row taller than that goes on over the next page. */
  const mostLines = Math.max(
    1,
    Math.floor((PAGE.height - MARGIN.top - MARGIN.bottom - headHeight - PAD.y * 2) / lineHeight(SIZE.cell)),
  );

  const linesOf = (cell: TableCell, index: number): DrawnLine[] => {
    if (cell === null || cell === "") return [];
    const pieces: TablePiece[] = typeof cell === "string" ? [{ text: cell }] : cell;
    return pieces.flatMap((piece) => {
      const font = piece.strong ? bold : regular;
      const wrapped = wrapText(closestText(piece.text), font, SIZE.cell, widths[index] - PAD.x * 2);
      return wrapped.map((text) => ({ text, font, soft: piece.soft === true }));
    });
  };

  for (const row of document.rows) {
    const cells = document.columns.map((_, index) => linesOf(row[index] ?? null, index));
    const total = Math.max(1, ...cells.map((lines) => lines.length));
    for (let from = 0; from < total; from += mostLines) {
      const shown = Math.min(mostLines, total - from);
      const height = shown * lineHeight(SIZE.cell) + PAD.y * 2;
      if (y - height < MARGIN.bottom) {
        newPage();
        drawHead();
      }
      cells.forEach((lines, index) => {
        lines.slice(from, from + shown).forEach((line, at) => {
          page.drawText(line.text, {
            x: lefts[index] + PAD.x,
            y: y - PAD.y - SIZE.cell - at * lineHeight(SIZE.cell),
            size: SIZE.cell,
            font: line.font,
            color: line.soft ? SOFT : INK,
          });
        });
      });
      y -= height;
      page.drawLine({
        start: { x: MARGIN.x, y },
        end: { x: MARGIN.x + width, y },
        thickness: 0.4,
        color: RULE,
      });
    }
  }

  // Each page says whose list it is and which page it is: a printed sheet that falls out of order is found again.
  const running = wrapText(closestText(document.title), regular, SIZE.running, width - 60)[0] ?? "";
  pages.forEach((sheet, index) => {
    const top = PAGE.height - MARGIN.top + 16;
    if (index > 0) sheet.drawText(running, { x: MARGIN.x, y: top, size: SIZE.running, font: regular, color: SOFT });
    const label = `${index + 1} / ${pages.length}`;
    sheet.drawText(label, {
      x: PAGE.width - MARGIN.x - regular.widthOfTextAtSize(label, SIZE.running),
      y: top,
      size: SIZE.running,
      font: regular,
      color: SOFT,
    });
  });

  return pdf.save();
}
