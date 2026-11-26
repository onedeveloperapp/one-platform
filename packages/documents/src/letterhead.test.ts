import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFOperator, PDFOperatorNames, PDFString, rgb, StandardFonts } from "pdf-lib";

import { LEAST_MARGIN, readPdfLetterhead, readPdfPaper } from "@flyee/documents/letterhead";

/** An A4 page of an invented firm's paper: a bar and its name above, its address below, and what `extra` draws. */
async function paper(extra?: (page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont) => void) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawRectangle({ x: 0, y: 800, width: 595.28, height: 20, color: rgb(0.1, 0.3, 0.6) });
  page.drawText("Souza Advogados", { x: 60, y: 770, size: 14, font });
  page.drawText("Rua das Flores, 100, Goiania", { x: 60, y: 30, size: 8, font });
  extra?.(page, font);
  return pdf.save();
}

describe("a blank page of the firm's paper", () => {
  it("is measured: the header down to its name, the footer up to its address, and the text kept clear of both", async () => {
    const read = await readPdfLetterhead(await paper());
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(Math.round(read.page.width), 595);
    // The name's lowest point is a little under its baseline at 770.
    assert.ok(read.header >= 72 && read.header <= 76, `header ${read.header}`);
    assert.ok(read.footer >= 36 && read.footer <= 38, `footer ${read.footer}`);
    assert.ok(read.margins.top >= read.header + 10);
    assert.equal(read.margins.bottom, Math.max(LEAST_MARGIN.bottom, read.footer + 14));
  });

  it("keeps a few words in the middle as the paper's own, and refuses a page with a piece's lines", async () => {
    const marked = await readPdfLetterhead(
      await paper((page, font) => page.drawText("CONFIDENCIAL", { x: 200, y: 420, size: 30, font })),
    );
    assert.equal(marked.ok, true);
    const written = await readPdfLetterhead(
      await paper((page, font) => {
        for (let line = 0; line < 12; line += 1) {
          page.drawText("O autor viajou no dia 3 e o voo atrasou seis horas.", { x: 60, y: 600 - line * 16, size: 11, font });
        }
      }),
    );
    assert.deepEqual(written, { ok: false, code: "not_blank" });
  });

  it("refuses a page with nothing printed, and what is no PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]);
    assert.deepEqual(await readPdfLetterhead(await pdf.save()), { ok: false, code: "empty" });
    assert.deepEqual(await readPdfLetterhead(new Uint8Array([1, 2, 3])), { ok: false, code: "not_pdf" });
  });
});

describe("a picture of the letterhead", () => {
  it("is kept no wider than 1200 pixels, a PNG where it is see-through and a JPEG otherwise", async () => {
    const sharp = (await import("sharp")).default;
    const { compressLetterheadImage } = await import("@flyee/documents/letterhead-image");
    const wide = await sharp({ create: { width: 3000, height: 600, channels: 3, background: { r: 20, g: 60, b: 140 } } })
      .png()
      .toBuffer();
    const kept = await compressLetterheadImage(new Uint8Array(wide));
    assert.equal(kept.mime, "image/jpeg");
    assert.equal(kept.width, 1200);
    assert.ok(kept.bytes.byteLength < wide.byteLength);
    const clear = await sharp({ create: { width: 400, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    assert.equal((await compressLetterheadImage(new Uint8Array(clear))).mime, "image/png");
  });
});

const PIECE = "O autor viajou no dia 3 e o voo atrasou seis horas, sem assistencia da companhia.";

/** The lines of a piece written down the middle of a page, as a document typed on the paper has them. */
function writePiece(page: import("pdf-lib").PDFPage, font: import("pdf-lib").PDFFont, from = 700, lines = 36) {
  for (let line = 0; line < lines; line += 1) {
    page.drawText(PIECE, { x: 85, y: from - line * 16, size: 11, font });
  }
}

describe("the firm's paper, copied", () => {
  it("copies a blank page as it is, measured as the blank page always was", async () => {
    const read = await readPdfPaper(await paper());
    assert.equal(read.ok, true);
    if (!read.ok) return;
    const blank = await readPdfLetterhead(await paper());
    assert.ok(blank.ok);
    assert.equal(read.pages, 1);
    assert.equal(read.stripped, false);
    assert.deepEqual(read.first, read.rest);
    assert.equal(read.first.header, Math.round(blank.header));
    assert.equal(read.first.footer, Math.round(blank.footer));
    assert.equal(read.first.margins.top, Math.round(blank.margins.top));
    assert.equal(read.first.margins.bottom, Math.round(blank.margins.bottom));
    assert.deepEqual(read.fonts, ["Helvetica"]);
    // What it copies is the same paper: the same bytes for the same file.
    const again = await readPdfPaper(await paper());
    assert.ok(again.ok);
    assert.deepEqual(again.pdf, read.pdf);
  });

  it("takes the text of a document out of the paper and keeps the header and the footer where they were", async () => {
    const written = await paper((page, font) => writePiece(page, font));
    const read = await readPdfPaper(written);
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.stripped, true);
    // The page left is a blank page of the same paper: its header, its footer, nothing between.
    const left = await readPdfLetterhead(read.pdf);
    assert.equal(left.ok, true, "the paper left holds no lines of the piece");
    const blank = await readPdfLetterhead(await paper());
    assert.ok(left.ok && blank.ok);
    assert.equal(left.header, blank.header);
    assert.equal(left.footer, blank.footer);
    // The text goes where the document's text was, never closer to the edge than the least.
    assert.equal(read.first.margins.left, 85);
  });

  it("takes out text however the page shows it, moving to its lines as it did", async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Souza Advogados", { x: 60, y: 770, size: 14, font });
    page.drawText("Rua das Flores, 100, Goiania", { x: 60, y: 30, size: 8, font });
    page.setFont(font);
    const key = (page as unknown as { fontKey: PDFName }).fontKey;
    const op = (name: string, ...args: (number | string | PDFArray)[]) =>
      PDFOperator.of(
        name as PDFOperatorNames,
        args.map((arg) =>
          typeof arg === "number" ? PDFNumber.of(arg) : typeof arg === "string" ? PDFString.of(arg) : arg,
        ),
      );
    const adjusted = pdf.context.obj([PDFString.of("O voo"), PDFNumber.of(-250), PDFString.of("atrasou")]);
    page.pushOperators(
      op(PDFOperatorNames.BeginText),
      PDFOperator.of(PDFOperatorNames.SetFontAndSize, [key, PDFNumber.of(11)]),
      op(PDFOperatorNames.SetTextLineHeight, 16),
      op(PDFOperatorNames.MoveText, 85, 560),
      op(PDFOperatorNames.ShowTextAdjusted, adjusted),
      ...Array.from({ length: 10 }, () => op(PDFOperatorNames.ShowTextLine, PIECE)),
      op(PDFOperatorNames.ShowTextLineAndSpace, 1, 0, PIECE),
      op(PDFOperatorNames.EndText),
    );
    const read = await readPdfPaper(await pdf.save());
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.stripped, true);
    assert.equal((await readPdfLetterhead(read.pdf)).ok, true);
  });

  it("keeps the first page of the paper and its following one, each measured, and no more", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (const top of [700, 790, 790]) {
      const page = pdf.addPage([595.28, 841.89]);
      // The first page's header goes down to a big logo, the others' to a line.
      page.drawRectangle({ x: 60, y: top, width: 200, height: 820 - top, color: rgb(0.1, 0.3, 0.6) });
      page.drawText("Rua das Flores, 100, Goiania", { x: 60, y: 30, size: 8, font });
      writePiece(page, font, top - 40, 20);
    }
    const read = await readPdfPaper(await pdf.save());
    assert.equal(read.ok, true);
    if (!read.ok) return;
    assert.equal(read.pages, 2);
    assert.equal((await PDFDocument.load(read.pdf)).getPageCount(), 2);
    assert.equal(read.first.header, Math.round(841.89 - 700));
    assert.equal(read.rest.header, Math.round(841.89 - 790));
    assert.ok(read.first.margins.top > read.rest.margins.top);
  });

  it("never puts the text closer to the edges than the Word document's own margins", async () => {
    const read = await readPdfPaper(await paper(), { base: { top: 170, bottom: 90, left: 85, right: 57 } });
    assert.ok(read.ok);
    assert.equal(read.first.margins.top, 170);
    assert.equal(read.first.margins.bottom, 90);
    assert.equal(read.first.margins.left, 85);
    assert.equal(read.first.margins.right, 57);
  });

  it("refuses a page with nothing printed, and what is no PDF", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595.28, 841.89]);
    assert.deepEqual(await readPdfPaper(await pdf.save()), { ok: false, code: "empty" });
    assert.deepEqual(await readPdfPaper(new Uint8Array([1, 2, 3])), { ok: false, code: "not_pdf" });
  });
});
