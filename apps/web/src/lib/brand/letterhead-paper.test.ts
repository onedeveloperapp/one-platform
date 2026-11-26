import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { docxFonts, docxPageMargins, letterheadPagesDocx, missingFonts, paperOf } from "@/lib/brand/letterhead-paper";

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"';

/** A box laid on the page by the body, with the paper's own words in it, as some letterheads are made. */
const ANCHORED =
  '<w:p><w:r><w:t>Excelentíssimo Senhor Juiz</w:t></w:r><w:r><w:drawing><wp:anchor behindDoc="1"><wp:extent cx="7560000" cy="900000"/>' +
  "<a:graphic><a:graphicData><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Souza Advogados</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic>" +
  "</wp:anchor></w:drawing></w:r></w:p>";

/** A Word document on an invented firm's letterhead with a piece written on it. */
function writtenDocx(options: { anchored?: boolean } = {}) {
  const body =
    (options.anchored ? ANCHORED : "") +
    "<w:p><w:r><w:t>O autor viajou no dia 3 e o voo atrasou seis horas.</w:t></w:r></w:p>" +
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Valor</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t xml:space="preserve">Termos em que pede deferimento.</w:t></w:r></w:p>' +
    '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/><w:footerReference w:type="first" r:id="rId8"/><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="2835" w:right="1134" w:bottom="1701" w:left="1701" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/header1.xml": strToU8(
      `<w:hdr ${W}><w:p><w:r><w:rPr><w:rFonts w:ascii="Aptos Light" w:hAnsi="Aptos Light"/></w:rPr><w:t>Souza &amp; Lima Advogados</w:t></w:r></w:p>` +
        `<w:p><w:r><w:rPr><w:rFonts w:ascii="Montserrat"/></w:rPr><w:t xml:space="preserve">  </w:t></w:r></w:p></w:hdr>`,
    ),
    "word/footer1.xml": strToU8(`<w:ftr ${W}><w:p><w:r><w:t>Rua das Flores, 100</w:t></w:r></w:p></w:ftr>`),
    "word/styles.xml": strToU8(
      `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
    ),
    "word/theme/theme1.xml": strToU8(
      `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
    ),
  });
}

const documentOf = (docx: Uint8Array) => strFromU8(unzipSync(docx)["word/document.xml"]!);

describe("the firm's Word letterhead made ready to be copied", () => {
  it("empties the body into two pages and keeps every other part, its last section's header and footer included", () => {
    const source = writtenDocx();
    const pages = letterheadPagesDocx(source);
    expect(pages).not.toBeNull();
    const document = documentOf(pages!);
    expect(document).not.toContain("O autor viajou");
    expect(document).not.toContain("<w:tbl>");
    expect(document).not.toContain("deferimento");
    expect(document).toContain('<w:br w:type="page"/>');
    expect(document).toContain('<w:footerReference w:type="first" r:id="rId8"/><w:titlePg/>');
    const before = unzipSync(source);
    const after = unzipSync(pages!);
    for (const part of ["word/header1.xml", "word/footer1.xml", "word/styles.xml", "word/theme/theme1.xml"]) {
      expect(after[part]).toEqual(before[part]);
    }
  });

  it("keeps what the body lays on the page, with the paper's words in it, and leaves the piece's words out", () => {
    const document = documentOf(letterheadPagesDocx(writtenDocx({ anchored: true }))!);
    expect(document).toContain("<wp:anchor");
    expect(document).toContain("Souza Advogados");
    expect(document).not.toContain("Excelentíssimo");
    expect(document).not.toContain("O autor viajou");
  });

  it("reads the document's own margins, in points", () => {
    expect(docxPageMargins(writtenDocx())).toEqual({ top: 141.75, bottom: 85.05, left: 85.05, right: 56.7 });
    expect(docxPageMargins(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(letterheadPagesDocx(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("names the fonts the letterhead writes text in: a run's own, or the document's for a run that names none", () => {
    // The run of blanks in Montserrat writes nothing; the address names no font and writes in the theme's.
    expect(docxFonts(writtenDocx())).toEqual(["Aptos Light", "Calibri"]);
  });

  it("says which fonts the server wrote in another, never one whose stand-in keeps its measure", () => {
    expect(missingFonts(["Aptos Light", "Calibri", "Arial"], ["Carlito", "LiberationSans-Bold", "DejaVuSans"])).toEqual(
      ["Aptos Light"],
    );
    expect(missingFonts(["Times New Roman", "Arial"], ["TimesNewRomanPSMT", "ArialMT"])).toEqual([]);
    expect(missingFonts(["Times New Roman"], ["LiberationSerif"])).toEqual([]);
    expect(missingFonts(["Montserrat"], ["Montserrat-Regular"])).toEqual([]);
  });
});

describe("where the firm's paper stands", () => {
  it("reads the database's row as the step says it", () => {
    expect(
      paperOf({
        letterhead_kind: "word",
        letterhead_paper_status: "ready",
        letterhead_paper_problem: null,
        letterhead_paper: { missing: ["Aptos Light", 3], stripped: true },
      }),
    ).toEqual({ status: "ready", problem: null, missing: ["Aptos Light"], stripped: true });
    expect(
      paperOf({ letterhead_kind: "word", letterhead_paper_status: "failed", letterhead_paper_problem: "refused" }),
    ).toEqual({
      status: "failed",
      problem: "refused",
      missing: [],
      stripped: false,
    });
    // A PDF read before 0300 is its own paper; no letterhead has none.
    expect(paperOf({ letterhead_kind: "pdf", letterhead_paper_status: null }).status).toBe("ready");
    expect(paperOf(null).status).toBeNull();
  });
});
