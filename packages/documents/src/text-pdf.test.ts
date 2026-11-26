import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { measureFile } from "./measure.ts";
import { stampVerification } from "./stamp.ts";
import {
  pageLayout,
  pageLayouts,
  PLAIN_CODES,
  renderTextPdf,
  type TextBlock,
  unwritableCharacters,
  wrapText,
  writableText,
} from "./text-pdf.ts";

const char = (code: number) => String.fromCodePoint(code);

describe("a document of text as a PDF", () => {
  it("writes what people paste in its plain form, and leaves out what the standard fonts cannot write", () => {
    const pasted = `${char(0x201c)}Atraso${char(0x201d)} de voo ${char(0x2013)} 6h${char(0x2026)} ${char(0x2022)} item${char(0x00a0)}um`;
    assert.equal(writableText(pasted), '"Atraso" de voo - 6h... - item um');
    assert.equal(writableText("Ação, coração, § 2º, à vista"), "Ação, coração, § 2º, à vista");
    assert.equal(writableText(`Maria ${char(0x1f600)} Teste${char(0x200b)}`), "Maria  Teste");
    assert.equal(writableText("linha um\nlinha dois\tfim"), "linha um\nlinha dois fim");
  });

  it("writes in a plain form what a copy brings with it: a ligature, a hyphen that does not break, a minus", () => {
    assert.equal(writableText(`con${char(0xfb01)}guração do o${char(0xfb01)}cio`), "configuração do oficio");
    assert.equal(writableText(`bem${char(0x2011)}estar, art. 5º${char(0x2011)}A, ${char(0x2212)}10`), "bem-estar, art. 5º-A, -10");
    assert.equal(
      writableText(`${char(0x201e)}aspas${char(0x201d)} e linha${char(0x000d)}${char(0x000a)}nova, hí${char(0x00ad)}fen`),
      `"aspas" e linha${char(0x000a)}nova, hífen`,
    );
    // An accent written apart from its letter is that letter.
    assert.equal(writableText("ae" + char(0x0301) + "reo"), "aéreo");
    // Every code it writes in a plain form is one it does not name as unwritable.
    for (const code of PLAIN_CODES) assert.deepEqual(unwritableCharacters(`a${char(code)}b`), [], code.toString(16));
  });

  it("names what it cannot write, each character once, and never stops on one", async () => {
    const text = `Atraso ${char(0x2265)} 4 horas ${char(0x2192)} dano; Dvo${char(0x0159)}ák; ${char(0x2265)} de novo ${char(0x1f600)}; ${char(0x0093)}aspas de outro sistema${char(0x0094)}`;
    assert.deepEqual(unwritableCharacters(text), [char(0x2265), char(0x2192), char(0x0159), char(0x1f600), char(0x0093), char(0x0094)]);
    assert.deepEqual(unwritableCharacters("Ação, coração, § 2º, à vista: nada a dizer."), []);
    // A control character of either range is left out, never an error of the font.
    assert.equal(writableText(`a${char(0x0093)}b${char(0x0007)}c${char(0x007f)}d`), "abcd");
    const pdf = await renderTextPdf({ blocks: [{ kind: "paragraph", text }] });
    assert.equal((await PDFDocument.load(pdf)).getPageCount(), 1);
  });

  it("breaks a text by the measure of its words, and cuts a word wider than the line", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrapText("uma frase de palavras curtas que não cabe em uma linha só", font, 10, 120);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(font.widthOfTextAtSize(line, 10) <= 120, line);
    assert.equal(lines.join(" "), "uma frase de palavras curtas que não cabe em uma linha só");

    const hash = "a".repeat(120);
    const cut = wrapText(`antes ${hash} depois`, font, 10, 120);
    // The end of the long word shares its line with what follows; nothing of it is lost.
    assert.equal(cut.join("").replaceAll(" ", ""), `antes${hash}depois`);

    // A word of any length is cut in the time of its length: a text with no space in it does not hold a worker.
    const endless = "x".repeat(60_000);
    const started = performance.now();
    const pieces = wrapText(endless, font, 10, 120);
    assert.ok(performance.now() - started < 3000, `${Math.round(performance.now() - started)} ms`);
    assert.equal(pieces.join(""), endless);
    for (const piece of pieces) assert.ok(font.widthOfTextAtSize(piece, 10) <= 120);
    for (const line of cut) assert.ok(font.widthOfTextAtSize(line, 10) <= 120);

    // A blank line stays a blank line.
    assert.deepEqual(wrapText("um\n\ndois", font, 10, 120), ["um", "", "dois"]);
  });

  it("lays the blocks out on as many A4 pages as they take, the same bytes for the same input", async () => {
    const blocks: TextBlock[] = [
      { kind: "title", text: "Dossiê do caso" },
      { kind: "heading", text: "Quem são as pessoas" },
      { kind: "fields", rows: [{ label: "Nome", value: "Maria Teste" }, { label: "Uma etiqueta bem comprida que não divide a linha com o seu valor", value: "valor" }] },
      { kind: "paragraph", text: "Um parágrafo. ".repeat(40), indent: true },
      { kind: "list", items: ["primeiro", "segundo ".repeat(30)], ordered: true },
      { kind: "list", items: ["sem ordem"] },
      { kind: "space", points: 20 },
      { kind: "pageBreak" },
      { kind: "paragraph", text: "Na página seguinte." },
    ];
    const first = await renderTextPdf({ blocks, header: "Souza Advogados", pageNumbers: true, title: "Dossiê", author: "Souza Advogados" });
    const second = await renderTextPdf({ blocks, header: "Souza Advogados", pageNumbers: true, title: "Dossiê", author: "Souza Advogados" });
    assert.deepEqual(Buffer.from(first), Buffer.from(second));

    const measured = await measureFile(first);
    assert.equal(measured.detectedMime, "application/pdf");
    assert.equal(measured.pages, 2);

    const long = await renderTextPdf({ blocks: [{ kind: "paragraph", text: "Linha de texto corrido. ".repeat(900) }] });
    const pages = (await PDFDocument.load(long)).getPages();
    assert.ok(pages.length >= 3);
    for (const page of pages) assert.deepEqual([Math.round(page.getWidth()), Math.round(page.getHeight())], [595, 842]);
  });

  it("says ONE made what ONE issues, and names only the firm in a piece that is the firm's", async () => {
    const blocks: TextBlock[] = [{ kind: "paragraph", text: "Excelentíssimo Juízo." }];
    const issued = await PDFDocument.load(await renderTextPdf({ blocks }), { updateMetadata: false });
    assert.equal(issued.getProducer(), "ONE");
    assert.equal(issued.getCreator(), "ONE");
    const piece = await renderTextPdf({ blocks, title: "Petição inicial", author: "Souza Advogados", producer: "Souza Advogados" });
    const read = await PDFDocument.load(piece, { updateMetadata: false });
    assert.equal(read.getProducer(), "Souza Advogados");
    assert.equal(read.getCreator(), "Souza Advogados");
    assert.equal(read.getAuthor(), "Souza Advogados");
    // Nothing in the bytes of the file names the platform.
    assert.equal(Buffer.from(piece).toString("latin1").includes("ONE"), false);
    // A name the file cannot write falls back to the platform's, never to nothing.
    assert.equal((await PDFDocument.load(await renderTextPdf({ blocks, producer: "  " }), { updateMetadata: false })).getProducer(), "ONE");
  });

  it("takes the verification mark at the foot of every page, and a text no standard font writes", async () => {
    const odd = await renderTextPdf({
      blocks: [
        { kind: "title", text: `Caso ${char(0x1f600)} de teste` },
        { kind: "paragraph", text: `${char(0x4e2d)}${char(0x6587)} e ${char(0x201c)}aspas${char(0x201d)}` },
        { kind: "heading", text: "" },
        { kind: "fields", rows: [] },
        { kind: "list", items: [] },
      ],
      header: "x".repeat(400),
    });
    const stamped = await stampVerification(odd, {
      firm: "Souza Advogados",
      verifyCode: "ABCDEFGHJKMN",
      verifyUrl: "https://one.invalid/verificar/ABCDEFGHJKMN",
    });
    assert.equal((await PDFDocument.load(stamped)).getPageCount(), 1);
    assert.ok(stamped.byteLength > odd.byteLength);
  });

  it("draws the firm's blank page under every page, keeps the text inside its margins and lifts the mark above its footer", async () => {
    const paper = await PDFDocument.create();
    const sheet = paper.addPage([595.28, 841.89]);
    sheet.drawText("Souza Advogados", { x: 60, y: 770, size: 14, font: await paper.embedFont(StandardFonts.Helvetica) });
    const letterhead = {
      kind: "page" as const,
      pdf: await paper.save(),
      margins: { top: 120, bottom: 90, left: 70, right: 60 },
    };
    const blocks = Array.from({ length: 60 }, (_, index) => ({
      kind: "paragraph" as const,
      text: `Parágrafo ${index + 1} da peça, escrito no timbrado do escritório.`,
    }));
    const bytes = await renderTextPdf({ blocks, letterhead, stamped: true });
    const loaded = await PDFDocument.load(bytes);
    assert.ok(loaded.getPageCount() >= 2, "the text runs over pages");
    const layout = pageLayout(letterhead, true);
    assert.equal(layout.top, 120);
    assert.equal(layout.stampAt, 78);
    // The footer ends 14 points under the margin: the mark sits on it, the text above the mark.
    assert.equal(layout.bottom, 76 + 56 + 10);
    // Without the mark, the text goes down to the letterhead's own margin.
    assert.equal(pageLayout(letterhead, false).bottom, 90);
    const stamped = await stampVerification(bytes, { firm: "Souza Advogados", verifyCode: "ABCD2345", verifyUrl: "https://one.invalid/verificar" }, { at: layout.stampAt });
    assert.equal((await PDFDocument.load(stamped)).getPageCount(), loaded.getPageCount());
  });

  it("draws the paper's first page under the first page and its following page under the others, each with its own margins", async () => {
    const paper = await PDFDocument.create();
    const font = await paper.embedFont(StandardFonts.Helvetica);
    for (const name of ["Souza Advogados, primeira folha", "Souza Advogados"]) {
      paper.addPage([595.28, 841.89]).drawText(name, { x: 60, y: 770, size: 14, font });
    }
    const letterhead = {
      kind: "page" as const,
      pdf: await paper.save(),
      page: 1,
      margins: { top: 100, bottom: 70, left: 70, right: 60 },
      first: { page: 0, margins: { top: 220, bottom: 110, left: 70, right: 60 } },
    };
    const layouts = pageLayouts(letterhead, true);
    assert.equal(layouts.first.top, 220);
    assert.equal(layouts.rest.top, 100);
    // The mark is at one height on every page, above the higher footer, and the text of every page above the mark.
    assert.equal(layouts.first.stampAt, layouts.rest.stampAt);
    assert.equal(layouts.rest.stampAt, 110 - 14 + 2);
    assert.ok(layouts.rest.bottom >= layouts.rest.stampAt + 10);
    assert.deepEqual(pageLayout(letterhead, true), layouts.rest);
    const blocks = Array.from({ length: 50 }, (_, index) => ({
      kind: "paragraph" as const,
      text: `Parágrafo ${index + 1} da peça, escrito no timbrado do escritório.`,
    }));
    const pages = (await PDFDocument.load(await renderTextPdf({ blocks, letterhead, stamped: true }))).getPageCount();
    // The same text on the following page alone takes no more pages: the first page holds fewer lines.
    const alone = (
      await PDFDocument.load(
        await renderTextPdf({ blocks, letterhead: { ...letterhead, first: undefined }, stamped: true }),
      )
    ).getPageCount();
    assert.ok(pages >= alone);
    // A paper of one page is drawn under every page as before.
    const single = pageLayouts({ kind: "page", pdf: letterhead.pdf, margins: letterhead.margins }, true);
    assert.deepEqual(single.first, single.rest);
  });

  it("draws the header and the footer of a Word letterhead, the text below and above them", async () => {
    const letterhead = {
      kind: "bands" as const,
      header: { lines: [{ text: "Souza & Lima Advogados", align: "center" as const, sizePt: 12, bold: true }], images: [] },
      footer: { lines: [{ text: "Rua das Flores, 100", align: "right" as const, sizePt: 8, bold: false }], images: [] },
      margins: { top: 100, bottom: 70, left: 85, right: 57, header: 28, footer: 28 },
    };
    const layout = pageLayout(letterhead, false);
    assert.equal(layout.left, 85);
    assert.ok(layout.top >= 28 + 12 * 1.3 + 14 && layout.top >= 100);
    assert.ok(layout.bottom >= 28 + 8 * 1.3 + 14);
    const bytes = await renderTextPdf({ blocks: [{ kind: "title", text: "Petição inicial" }], letterhead, stamped: false });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  });
});
