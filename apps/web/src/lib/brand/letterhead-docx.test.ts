import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readDocxLetterhead, writeDocxOnLetterhead } from "@/lib/brand/letterhead-docx";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const REL = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A Word document on an invented firm's letterhead: a logo and its name above, its address below. */
function letterheadDocx(options: { header?: boolean; footer?: boolean; fontTheme?: boolean } = {}) {
  const { header = true, footer = true } = options;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<w:document ${W}><w:body><w:p><w:r><w:t>Texto antigo da peça</w:t></w:r></w:p>` +
        `<w:sectPr>${header ? '<w:headerReference w:type="default" r:id="rId7"/>' : ""}${footer ? '<w:footerReference w:type="default" r:id="rId8"/>' : ""}` +
        `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2835" w:right="1134" w:bottom="1701" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`,
    ),
    "word/_rels/document.xml.rels": strToU8(
      `<Relationships ${REL}><Relationship Id="rId7" Target="header1.xml"/><Relationship Id="rId8" Target="footer1.xml"/></Relationships>`,
    ),
    "word/header1.xml": strToU8(
      `<w:hdr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline><wp:extent cx="1905000" cy="635000"/><a:graphic><a:graphicData><a:blip r:embed="rId1"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
        `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>Souza &amp; Lima Advogados</w:t></w:r></w:p></w:hdr>`,
    ),
    "word/_rels/header1.xml.rels": strToU8(
      `<Relationships ${REL}><Relationship Id="rId1" Target="media/image1.png"/></Relationships>`,
    ),
    "word/footer1.xml": strToU8(
      `<w:ftr ${W}><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>Rua das Flores, 100</w:t></w:r><w:r><w:tab/><w:t>Goiânia</w:t></w:r></w:p></w:ftr>`,
    ),
    "word/media/image1.png": PNG,
    "word/styles.xml": strToU8(
      options.fontTheme
        ? `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
        : `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    ),
    "word/theme/theme1.xml": strToU8(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    ),
  };
  return zipSync(files);
}

describe("the letterhead of a Word document", () => {
  it("reads the page, the margins, the header and the footer, with their pictures and their font", () => {
    const read = readDocxLetterhead(letterheadDocx());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.page).toEqual({
      width: 595.3,
      height: 841.9,
      margins: { top: 141.75, bottom: 85.05, left: 85.05, right: 56.7, header: 28.35, footer: 28.35 },
    });
    expect(read.header.images).toEqual([
      { part: "word/media/image1.png", mime: "image/png", widthPt: 150, heightPt: 50, align: "center" },
    ]);
    expect(read.header.lines).toEqual([{ text: "Souza & Lima Advogados", align: "center", sizePt: 12, bold: true }]);
    expect(read.footer.lines).toEqual([
      { text: "Rua das Flores, 100 Goiânia", align: "right", sizePt: 8, bold: false },
    ]);
    expect(read.font).toBe("Garamond");
    expect(Array.from(read.media["word/media/image1.png"]!)).toEqual(Array.from(PNG));
  });

  it("reads the theme's font when the document names it by the theme", () => {
    const read = readDocxLetterhead(letterheadDocx({ fontTheme: true }));
    expect(read.ok && read.font).toBe("Calibri");
  });

  it("says when a document has no letterhead, and when it is no Word document", () => {
    expect(readDocxLetterhead(letterheadDocx({ header: false, footer: false }))).toEqual({
      ok: false,
      code: "no_letterhead",
    });
    expect(readDocxLetterhead(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, code: "not_docx" });
  });
});

describe("a piece written on the firm's own document", () => {
  it("replaces the body and keeps the section, the header, the footer and every other part", () => {
    const written = writeDocxOnLetterhead(letterheadDocx(), [
      { kind: "title", text: "Petição inicial" },
      { kind: "heading", text: "DOS FATOS" },
      { kind: "paragraph", text: "O autor viajou em 3 de março & voltou.", indent: true },
    ]);
    expect(written).not.toBeNull();
    const files = unzipSync(written!);
    const document = strFromU8(files["word/document.xml"]!);
    expect(document).not.toContain("Texto antigo da peça");
    expect(document).toContain("Petição inicial");
    expect(document).toContain("O autor viajou em 3 de março &amp; voltou.");
    expect(document).toContain('<w:headerReference w:type="default" r:id="rId7"/>');
    expect(document).toContain('w:top="2835"');
    expect(Object.keys(files).sort()).toEqual(Object.keys(unzipSync(letterheadDocx())).sort());
    // What it wrote is still the firm's letterhead.
    const again = readDocxLetterhead(written!);
    expect(again.ok && again.header.lines[0]?.text).toBe("Souza & Lima Advogados");
  });

  it("refuses what is no Word document", () => {
    expect(writeDocxOnLetterhead(new Uint8Array([1, 2, 3]), [])).toBeNull();
  });
});
