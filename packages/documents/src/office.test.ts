import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PDFDocument } from "pdf-lib";

import { fakeConverter, gotenbergConverter } from "@flyee/documents/office";

/**
 * The Word document made a PDF by the office suite on ONE's server (Gotenberg's LibreOffice route, in the shapes of
 * its documentation of the 9.x line): what is asked of it, and what each of its answers means. The suite stands in.
 */

const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

async function onePage(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage([595.28, 841.89]);
  return pdf.save();
}

describe("the office suite on ONE's server", () => {
  it("is asked to convert the document as a .docx in the field `files` of its LibreOffice route", async () => {
    const asked: { url: string; method: string; name: string | null; type: string | null; size: number }[] = [];
    const pdf = await onePage();
    const converter = gotenbergConverter({
      url: "http://conversor-office:3000/",
      fetch: async (url, init) => {
        const form = init?.body as FormData;
        const file = form.get("files") as File | null;
        asked.push({
          url: String(url),
          method: String(init?.method),
          name: file?.name ?? null,
          type: file?.type ?? null,
          size: file?.size ?? 0,
        });
        return new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } });
      },
    });
    const result = await converter.docxToPdf(DOCX);
    assert.deepEqual(asked, [
      {
        url: "http://conversor-office:3000/forms/libreoffice/convert",
        method: "POST",
        name: "timbrado.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: DOCX.length,
      },
    ]);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.pdf, pdf);
  });

  it("says a file it cannot convert is refused, and a suite that did not answer is unavailable", async () => {
    const answering = (status: number, body = "x") =>
      gotenbergConverter({ url: "http://conversor-office:3000", fetch: async () => new Response(body, { status }) });
    assert.deepEqual(await answering(400).docxToPdf(DOCX), { ok: false, code: "refused" });
    assert.deepEqual(await answering(503).docxToPdf(DOCX), { ok: false, code: "unavailable" });
    // An answer that is no PDF is no conversion.
    assert.deepEqual(await answering(200, "<html></html>").docxToPdf(DOCX), { ok: false, code: "unavailable" });
    const silent = gotenbergConverter({
      url: "http://conversor-office:3000",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    assert.deepEqual(await silent.docxToPdf(DOCX), { ok: false, code: "unavailable" });
  });

  it("stands in with a paper of two pages of its own where no suite is at hand", async () => {
    const result = await fakeConverter().docxToPdf(DOCX);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal((await PDFDocument.load(result.pdf)).getPageCount(), 2);
    assert.deepEqual(await fakeConverter(async () => ({ ok: false, code: "refused" })).docxToPdf(DOCX), {
      ok: false,
      code: "refused",
    });
  });
});
