import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { readDocx } from "@/lib/library/docx";

/**
 * The text of a Word document as the library reads it (migration 0067). The
 * documents are built here, part by part, as a word processor writes them:
 * every name, number and fact in them is invented.
 */

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A Word package with the given body and, when given, its lists and notes. */
function docx(body: string, parts: { numbering?: string; footnotes?: string; endnotes?: string } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906"/></w:sectPr></w:body></w:document>`),
    // The firm's letterhead lives in the header, which is never text of the document.
    "word/header1.xml": strToU8(`<w:hdr ${W}><w:p><w:r><w:t>Escritório Exemplo Advogados</w:t></w:r></w:p></w:hdr>`),
  };
  if (parts.numbering) files["word/numbering.xml"] = strToU8(`<w:numbering ${W}>${parts.numbering}</w:numbering>`);
  if (parts.footnotes) files["word/footnotes.xml"] = strToU8(`<w:footnotes ${W}>${parts.footnotes}</w:footnotes>`);
  if (parts.endnotes) files["word/endnotes.xml"] = strToU8(`<w:endnotes ${W}>${parts.endnotes}</w:endnotes>`);
  return zipSync(files);
}

const run = (text: string, properties = "") =>
  `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
const listed = (list: number, level: number, text: string) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${list}"/></w:numPr></w:pPr>${run(text)}</w:p>`;

const read = (bytes: Uint8Array) => {
  const result = readDocx(bytes);
  if (!result.ok) throw new Error(result.code);
  return result.paragraphs;
};

describe("the text of a Word document", () => {
  it("reads each paragraph as the page shows it: its runs, a tab as a space, a line break kept", () => {
    const body = [
      paragraph(run("EXCELEN"), run("TÍSSIMO", "<w:b/>"), run(" SENHOR JUIZ")),
      "<w:p/>",
      paragraph(run("   ")),
      paragraph(run("Fulano de Tal"), "<w:r><w:br/></w:r>", run("OAB/XX 00.000")),
      paragraph(
        run("Valor:"),
        "<w:r><w:tab/></w:r>",
        run("R$ 1.000,00 &amp; juros"),
        "<w:r><w:noBreakHyphen/></w:r>",
        run("x"),
      ),
      paragraph(run("antes da quebra de página"), '<w:r><w:br w:type="page"/></w:r>'),
    ].join("");
    expect(read(docx(body))).toEqual([
      "EXCELENTÍSSIMO SENHOR JUIZ",
      "Fulano de Tal\nOAB/XX 00.000",
      "Valor: R$ 1.000,00 & juros-x",
      "antes da quebra de página",
    ]);
  });

  it("leaves out what the page does not show: deleted, hidden, a field's code, a text box, a comment", () => {
    const body = paragraph(
      run("Texto "),
      `<w:del w:id="1" w:author="Revisor"><w:r><w:delText>apagado </w:delText></w:r></w:del>`,
      `<w:ins w:id="2" w:author="Revisor">${run("inserido ")}</w:ins>`,
      run("oculto ", "<w:vanish/>"),
      run("visível ", '<w:vanish w:val="0"/>'),
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r>`,
      `<w:r><w:fldChar w:fldCharType="separate"/></w:r>${run("3")}<w:r><w:fldChar w:fldCharType="end"/></w:r>`,
      `<w:r><mc:AlternateContent xmlns:mc="m"><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${paragraph(run("caixa"))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict>${paragraph(run("de novo"))}</w:pict></mc:Fallback></mc:AlternateContent></w:r>`,
      `<w:r><w:commentReference w:id="4"/></w:r>`,
      run(" fim"),
    );
    // The mark that hides the end of a paragraph hides no text of it.
    const marked = `<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr>${run("Parágrafo com o fim oculto")}</w:p>`;
    expect(read(docx(body + marked))).toEqual(["Texto inserido visível 3 fim", "Parágrafo com o fim oculto"]);
  });

  it("writes the number or letter each list gives its paragraphs, as Word counts them", () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%2."/></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1 -"/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/><w:isLgl/></w:lvl>
      </w:abstractNum>
      <w:abstractNum w:abstractNumId="2">
        <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
      <w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
      <w:num w:numId="4"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num>`;
    const body = [
      listed(2, 0, "DOS FATOS"),
      listed(2, 1, "Da relação de consumo"),
      listed(2, 1, "Do dano"),
      listed(2, 0, "DOS PEDIDOS"),
      listed(1, 0, "a citação da ré;"),
      listed(1, 1, "primeiro ponto;"),
      listed(1, 1, "segundo ponto;"),
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>',
      listed(1, 0, "a inversão do ônus da prova;"),
      listed(3, 0, "um item"),
      listed(4, 0, "um pedido que começa no d;"),
      listed(0, 0, "um parágrafo sem lista"),
    ].join("");
    expect(read(docx(body, { numbering }))).toEqual([
      "I - DOS FATOS",
      "1.1 Da relação de consumo",
      "1.2 Do dano",
      "II - DOS PEDIDOS",
      "a) a citação da ré;",
      "i. primeiro ponto;",
      "ii. segundo ponto;",
      // An empty item of a list is counted, as Word counts it, and never written.
      "c) a inversão do ônus da prova;",
      "• um item",
      "d) um pedido que começa no d;",
      "um parágrafo sem lista",
    ]);
  });

  it("reads a table as a line per row, its cells separated, and a table inside a cell in that cell", () => {
    const cell = (...content: string[]) => `<w:tc><w:tcPr/>${content.join("")}</w:tc>`;
    const row = (...cells: string[]) => `<w:tr>${cells.join("")}</w:tr>`;
    const inner = `<w:tbl>${row(cell(paragraph(run("dentro"))), cell(paragraph(run("da célula"))))}</w:tbl>`;
    const body = [
      paragraph(run("Antes da tabela")),
      `<w:tbl><w:tblPr/>${row(cell(paragraph(run("Despesa"))), cell(paragraph(run("Valor"))))}${row(
        cell(paragraph(run("Alimentação"))),
        cell(paragraph(run("R$ 80,00")), paragraph(run("com recibo"))),
      )}${row(cell(paragraph(run(""))), cell(inner))}</w:tbl>`,
      paragraph(run("Depois da tabela")),
    ].join("");
    expect(read(docx(body))).toEqual([
      "Antes da tabela",
      "Despesa | Valor",
      "Alimentação | R$ 80,00 com recibo",
      "dentro | da célula",
      "Depois da tabela",
    ]);
  });

  it("calls a note by its number where the text calls it, and writes the notes at the end", () => {
    const footnotes = `
      <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
      <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
      <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${run(" Nota sobre a doutrina citada.")}</w:p></w:footnote>
      <w:footnote w:id="2"><w:p>${run("Segunda nota,")}</w:p><w:p>${run("em dois parágrafos.")}</w:p></w:footnote>`;
    const endnotes = `<w:endnote w:id="1"><w:p>${run("Nota de fim.")}</w:p></w:endnote>`;
    const body = [
      paragraph(run("Primeiro argumento."), '<w:r><w:footnoteReference w:id="1"/></w:r>'),
      paragraph(
        run("Segundo."),
        '<w:r><w:endnoteReference w:id="1"/></w:r>',
        run(" E mais."),
        '<w:r><w:footnoteReference w:id="2"/></w:r>',
      ),
    ].join("");
    expect(read(docx(body, { footnotes, endnotes }))).toEqual([
      "Primeiro argumento.[1]",
      "Segundo.[2] E mais.[3]",
      "NOTAS",
      "[1] Nota sobre a doutrina citada.",
      "[2] Nota de fim.",
      "[3] Segunda nota, em dois parágrafos.",
    ]);
  });

  it("refuses what is no Word document, and one that unpacks to more than its ceiling", () => {
    expect(readDocx(strToU8("não é um zip"))).toEqual({ ok: false, code: "not_docx" });
    expect(readDocx(zipSync({ "xl/workbook.xml": strToU8("<workbook/>") }))).toEqual({ ok: false, code: "not_docx" });
    const long = docx(paragraph(run("a".repeat(5000))));
    expect(readDocx(long, 4096)).toEqual({ ok: false, code: "too_large" });
    expect(readDocx(long).ok).toBe(true);
  });
});
