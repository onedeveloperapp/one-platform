import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

import { LEAST_MARGIN, readPdfLetterhead } from "@flyee/documents/letterhead";

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
