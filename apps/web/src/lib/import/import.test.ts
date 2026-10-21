// @vitest-environment node
import { strToU8, zipSync } from "fflate";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { decodeText, detectDelimiter, parseDelimited, readCsv } from "@/lib/import/csv";
import { parseDateValue, resolveDateOrder } from "@/lib/import/dates";
import { guessColumnMapping, missingRequired, normalizeHeader } from "@/lib/import/mapping";
import { namesMatch, nameWords, SLUG_FROM, SLUG_TO } from "@/lib/import/names";
import {
  airlineOf,
  buildPortfolioPreview,
  cnjOf,
  cpfOwnersOf,
  endedBy,
  isImpreciseNumber,
  portfolioHeaderScore,
  type PreviewInput,
  withAirlineChoices,
} from "@/lib/import/portfolio";
import { readSpreadsheet } from "@/lib/import/read";
import { columnLetters, headerChoices, sniffSpreadsheet, tableOf, withHeaderAt } from "@/lib/import/table";
import { excelDate, numberOf, readXlsx } from "@/lib/import/xlsx";
import { composeCnj, formatCnj } from "@flyee/rules/cnj";

/** Lawsuits that exist nowhere: numbers of a year to come, made of invented parts, with their check digits. */
const GOIAS = composeCnj({ sequence: 5000123, year: 2099, court: "09", origin: 51 });
const SAO_PAULO = composeCnj({ sequence: 1000234, year: 2099, court: "26", origin: 100 });
const LEADING = composeCnj({ sequence: 12345, year: 2099, court: "09", origin: 51 });
const FEDERAL = composeCnj({ sequence: 5000999, year: 2099, segment: "4", court: "01", origin: 3500 });

const latin1 = (text: string) => Uint8Array.from(text, (letter) => letter.charCodeAt(0));

describe("what a file is, by its bytes", () => {
  it("tells a workbook and a text apart from what it does not read", () => {
    expect(sniffSpreadsheet(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe("xlsx");
    expect(sniffSpreadsheet(new TextEncoder().encode("Processo;Cliente\n1;Maria"))).toBe("csv");
    expect(sniffSpreadsheet(latin1("Número;Situação\n1;Ativo"))).toBe("csv");
    expect(sniffSpreadsheet(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe("legacy-office");
    expect(sniffSpreadsheet(new TextEncoder().encode("%PDF-1.7"))).toBe("pdf");
    expect(sniffSpreadsheet(new Uint8Array([0xff, 0xfe, 0x50, 0x00]))).toBe("utf-16");
    expect(sniffSpreadsheet(new Uint8Array([1, 2, 0, 3]))).toBe("binary");
    expect(sniffSpreadsheet(new Uint8Array())).toBe("empty");
  });
});

describe("a text export", () => {
  it("is read in its encoding, by its delimiter, with quoted cells", () => {
    expect(decodeText(latin1("Situação"))).toBe("Situação");
    expect(decodeText(new TextEncoder().encode(`${String.fromCharCode(0xfeff)}Situação`))).toBe("Situação");
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter("so uma coluna\nvalor\n")).toBe(";");
    expect(parseDelimited('a;"b; com ponto e virgula";"aspas ""dentro"""\r\n1;"duas\nlinhas";3', ";")).toEqual([
      ["a", "b; com ponto e virgula", 'aspas "dentro"'],
      ["1", "duas\nlinhas", "3"],
    ]);
  });

  it("finds its delimiter under a report's title, and is not taken by a comma inside a cell", () => {
    expect(detectDelimiter("Relatório de processos\nProcesso,Cliente,Situação\n1,Maria,Ativo\n2,João,Ativo\n")).toBe(
      ",",
    );
    expect(
      detectDelimiter(
        "Processo;Cliente;Parte contrária\n1;Maria;Gol Linhas Aéreas, S.A.\n2;João;Azul\n3;Ana;TAM, Linhas Aéreas\n",
      ),
    ).toBe(";");
  });

  it("weighs a delimiter by the cells it cuts, so a comma inside a value never takes a file of ;", () => {
    const values = Array.from({ length: 12 }, (_, index) => `${index};Cliente ${index};Goiânia;1.500,00;Ativo`);
    expect(
      detectDelimiter(
        [
          "Relatório, emitido em 10/10/2026",
          "Filtros: ativos, todos",
          "Processo;Cliente;Comarca;Valor;Situação",
          ...values,
        ].join("\n"),
      ),
    ).toBe(";");
    // Lines that lost their last cells still agree with the rest more than a comma does.
    const ragged = [...values.slice(0, 8), "9;Cliente 9", "10;Cliente 10;Goiânia", ...values.slice(10)];
    expect(detectDelimiter(["Processo;Cliente;Comarca;Valor;Situação", ...ragged].join("\n"))).toBe(";");
  });

  it("becomes a table whose first line with something is the headers, each row with the line it was on", () => {
    const read = readCsv(latin1("\r\nNúmero do processo;Cliente\r\n\r\n123;Maria Teste\r\n;\r\n456;João Teste\r\n"));
    expect(read.ok && read.table.headers).toEqual(["Número do processo", "Cliente"]);
    expect(read.ok && read.table.rows).toEqual([
      ["123", "Maria Teste"],
      ["456", "João Teste"],
    ]);
    expect(read.ok && read.table.lines).toEqual([4, 6]);
    expect(readCsv(new TextEncoder().encode("Só o cabeçalho;Sem linhas\n"))).toEqual({ ok: false, code: "no_rows" });
    expect(tableOf([], "csv", null)).toEqual({ ok: false, code: "no_rows" });
  });

  it("finds the headers under a report's title, its firm and its day, and keeps each row's own line", () => {
    const cells = [
      ["Souza Advogados"],
      ["Relatório de processos", "", "", "Emitido em 10/10/2026"],
      [],
      ["Número do processo", "Cliente", "Parte contrária", "Vara", "Comarca", "Situação"],
      [formatCnj(GOIAS) ?? "", "Maria Teste", "", "", "", ""],
      [formatCnj(SAO_PAULO) ?? "", "João Teste", "Gol", "1ª Vara", "Goiânia", "Ativo"],
    ];
    for (const options of [{}, { headerScore: portfolioHeaderScore }]) {
      const report = tableOf(cells, "xlsx", "Planilha1", options);
      expect(report.ok && report.table.headers).toEqual([
        "Número do processo",
        "Cliente",
        "Parte contrária",
        "Vara",
        "Comarca",
        "Situação",
      ]);
      expect(report.ok && report.table.lines).toEqual([5, 6]);
    }
    // A title of two cells over four columns: read as a title by how full it is, and by what the headers name.
    const short = [
      ["Souza Advogados", "Emitido em 10/10/2026"],
      ["Processo", "Cliente", "CPF", "Situação"],
      [formatCnj(GOIAS) ?? "", "Maria Teste", "", "Ativo"],
    ];
    for (const options of [{}, { headerScore: portfolioHeaderScore }]) {
      const read = tableOf(short, "csv", null, options);
      expect(read.ok && read.table.headers).toEqual(["Processo", "Cliente", "CPF", "Situação"]);
    }
    // Headers less full than the lines under them are told by what they name.
    const sparse = [
      ["Processo", "Cliente", "", ""],
      [formatCnj(GOIAS) ?? "", "Maria Teste", "x", "y"],
    ];
    const told = tableOf(sparse, "csv", null, { headerScore: portfolioHeaderScore });
    expect(told.ok && told.table.headers).toEqual(["Processo", "Cliente", "", ""]);
    // A sheet of one column has its first line as the header.
    const narrow = tableOf([["Processo"], ["123"], ["456"]], "csv", null);
    expect(narrow.ok && narrow.table.headers).toEqual(["Processo"]);
    expect(narrow.ok && narrow.table.lines).toEqual([2, 3]);
    // A line with a lawsuit's number, whole or cut by Excel, is a line of data: the headers are above it.
    expect(portfolioHeaderScore([formatCnj(GOIAS) ?? "", "Juizado Especial Cível", "Procedimento comum"])).toBe(-1);
    expect(portfolioHeaderScore(["5,12346E+19", "Maria Teste"])).toBe(-1);
    expect(portfolioHeaderScore(["Processo", "Cliente", "Vara"])).toBe(3);
    expect(portfolioHeaderScore(["Relatório de processos do escritório"])).toBeLessThan(2);
  });

  it("takes the headers above the first line of data, the nearest of equals, and lets a person choose another", () => {
    // Headers of other names than the usual, and a first line of data with no number yet, which names three facts.
    const odd = [
      ["Nº", "Requerentes", "Requeridos", "Órgão", "Situação"],
      ["", "João Teste", "Comarca de Goiânia", "3º Juizado Especial Cível", "Situação: Ativo"],
      [formatCnj(GOIAS) ?? "", "Maria Teste", "Gol", "1º Juizado", "Ativo"],
    ];
    const read = tableOf(odd, "csv", null, { headerScore: portfolioHeaderScore });
    expect(read.ok && read.table.headers).toEqual(["Nº", "Requerentes", "Requeridos", "Órgão", "Situação"]);
    expect(read.ok && guessColumnMapping(read.table.headers)).toMatchObject({
      cnj: 0,
      client_name: 1,
      opponent: 2,
      unit: 3,
      status: 4,
    });
    // A filter line that names as much as the headers above them: the headers are the line nearest the data.
    const tied = [
      ["Situação", "Comarca", "", ""],
      ["Processo", "Cliente", "Comarca", "Situação"],
      [formatCnj(GOIAS) ?? "", "Maria Teste", "Goiânia", "Ativo"],
    ];
    const near = tableOf(tied, "csv", null, { headerScore: portfolioHeaderScore });
    expect(near.ok && near.table.headers).toEqual(["Processo", "Cliente", "Comarca", "Situação"]);
    // The person says the headers are on another line: the lines above it are left out of the rows.
    if (!near.ok) return;
    expect(headerChoices(near.table).map((choice) => [choice.index, choice.line, choice.preview])).toEqual([
      [0, 1, "Situação · Comarca"],
      [1, 2, "Processo · Cliente · Comarca · Situação"],
      [2, 3, `${formatCnj(GOIAS)} · Maria Teste · Goiânia · Ativo`],
    ]);
    const chosen = withHeaderAt(near.table, 0);
    expect(chosen.ok && chosen.table.headers).toEqual(["Situação", "Comarca", "", ""]);
    expect(chosen.ok && chosen.table.lines).toEqual([2, 3]);
    expect(chosen.ok && withHeaderAt(chosen.table, 1)).toMatchObject({ ok: true, table: { lines: [3] } });
    // A table made by hand has nothing to choose from.
    expect(headerChoices({ headers: ["a"], rows: [["1"]], lines: [2], format: "csv", sheet: null })).toEqual([]);
  });

  it("names a column by its letters when its header is empty", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetters)).toEqual([
      "A",
      "B",
      "Z",
      "AA",
      "AB",
      "AZ",
      "BA",
      "ZZ",
      "AAA",
    ]);
  });
});

/** A workbook made here, in the parts a real one has. */
function workbook(
  sheet: string,
  options: {
    strings?: string[];
    styles?: string;
    date1904?: boolean;
    sheets?: string;
    extra?: Record<string, string>;
  } = {},
) {
  const strings = options.strings ?? [];
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="r"><workbookPr${options.date1904 ? ' date1904="1"' : ""}/><sheets>${
        options.sheets ?? '<sheet name="Processos &amp; clientes" sheetId="1" r:id="rId1"/>'
      }</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": strToU8(
      `<?xml version="1.0"?><sst>${strings.map((text) => (text === "" ? "<si/>" : `<si><t xml:space="preserve">${text}</t></si>`)).join("")}</sst>`,
    ),
    "xl/styles.xml": strToU8(
      options.styles ??
        '<?xml version="1.0"?><styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="&quot;R$&quot; #,##0.00"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/><xf numFmtId="22"/></cellXfs></styleSheet>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet><sheetData>${sheet}</sheetData></worksheet>`),
    ...Object.fromEntries(Object.entries(options.extra ?? {}).map(([name, text]) => [name, strToU8(text)])),
  });
}

describe("an Excel workbook", () => {
  it("is read by its shared strings, its inline ones, its numbers and its dates", () => {
    const bytes = workbook(
      [
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>',
        // A cell that closes itself before one that does not; a number; a date by a built-in style, and one by a custom one.
        `<row r="2"><c r="A2" t="inlineStr"><is><t>${formatCnj(GOIAS)}</t></is></c><c r="B2" s="0"/><c r="C2" s="1"><v>46237</v></c><c r="D2" s="3"><v>15000.5</v></c></row>`,
        '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="C4" s="2"><v>46237.75</v></c><c r="D4" t="str"><f>1+1</f><v>dois &amp; meio</v></c></row>',
      ].join(""),
      { strings: ["Processo", "Cliente", "Distribuição", "Valor", "texto &lt;b&gt;"] },
    );
    const read = readXlsx(bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.table.sheet).toBe("Processos & clientes");
    expect(read.table.headers).toEqual(["Processo", "Cliente", "Distribuição", "Valor"]);
    expect(read.table.rows).toEqual([
      [formatCnj(GOIAS), "", "2026-08-03", "15000.5"],
      ["texto <b>", "", "2026-08-03 18:00", "dois & meio"],
    ]);
    // The lines of the sheet, the empty one between counted.
    expect(read.table.lines).toEqual([2, 4]);
  });

  it("reads elements with a namespace's prefix, as some programs write them", () => {
    const sheet =
      '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Processo</x:t></x:is></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>Cliente</x:t></x:is></x:c></x:row>' +
      `<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>${formatCnj(GOIAS)}</x:t></x:is></x:c><x:c r="B2" t="s"><x:v>0</x:v></x:c></x:row>`;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Dados" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>',
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        '<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
      ),
      "xl/sharedStrings.xml": strToU8('<x:sst xmlns:x="m"><x:si><x:t>Maria Teste</x:t></x:si></x:sst>'),
      "xl/worksheets/sheet1.xml": strToU8(`<x:worksheet xmlns:x="m"><x:sheetData>${sheet}</x:sheetData></x:worksheet>`),
    });
    const read = readXlsx(bytes);
    expect(read.ok && read.table).toMatchObject({
      sheet: "Dados",
      headers: ["Processo", "Cliente"],
      rows: [[formatCnj(GOIAS), "Maria Teste"]],
    });
  });

  it("reads the first sheet a person sees, and leaves out a hidden one", () => {
    const bytes = workbook(
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Interno</t></is></c><c r="B1" t="inlineStr"><is><t>Chave</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>x</t></is></c><c r="B2" t="inlineStr"><is><t>y</t></is></c></row>',
      {
        sheets:
          '<sheet name="Sistema" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Processos" sheetId="2" r:id="rId2"/>',
        extra: {
          "xl/worksheets/sheet2.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Processo</t></is></c><c r="B1" t="inlineStr"><is><t>Cliente</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${formatCnj(GOIAS)}</t></is></c><c r="B2" t="inlineStr"><is><t>Maria Teste</t></is></c></row></sheetData></worksheet>`,
        },
      },
    );
    const read = readXlsx(bytes);
    expect(read.ok && read.table.sheet).toBe("Processos");
    expect(read.ok && read.table.rows).toEqual([[formatCnj(GOIAS), "Maria Teste"]]);
  });

  it("leaves out rows with nothing in them, however far down a sheet says it goes", () => {
    const filled = `<row r="1"><c r="A1" t="inlineStr"><is><t>Processo</t></is></c><c r="B1" t="inlineStr"><is><t>Cliente</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${formatCnj(GOIAS)}</t></is></c><c r="B2" t="inlineStr"><is><t>Maria Teste</t></is></c></row>`;
    // A cell somebody once formatted, two hundred thousand rows below.
    const read = readXlsx(workbook(`${filled}<row r="200001"><c r="A200001" s="1"/></row>`));
    expect(read.ok && read.table.rows).toHaveLength(1);
    expect(read.ok && read.table.lines).toEqual([2]);
  });

  it("never turns a number Excel rounded into twenty digits", () => {
    // A lawsuit's number of twenty digits kept as a number keeps fifteen: the rest Excel writes as zeros, and
    // twenty digits read from it may be another lawsuit's, with check digits that pass.
    const rounded = `${GOIAS.slice(0, 15)}00000`;
    expect(numberOf(rounded)).toBe(Number(rounded).toExponential().replace("e", "E"));
    expect(numberOf("5.0001236020998E+19")).toBe("5.0001236020998E+19");
    expect(numberOf("12320248090051")).toBe("12320248090051");
    expect(numberOf("15000.5")).toBe("15000.5");
    const read = readXlsx(
      workbook(
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Processo</t></is></c><c r="B1" t="inlineStr"><is><t>Cliente</t></is></c></row><row r="2"><c r="A2"><v>5.0001236020998E+19</v></c><c r="B2" t="inlineStr"><is><t>Maria Teste</t></is></c></row>',
      ),
    );
    expect(read.ok && read.table.rows[0][0]).toBe("5.0001236020998E+19");
    // With an exponent, or in full as a text export writes it, with or without the dots of a number.
    for (const cell of ["5.0001236020998E+19", "5,00012E+19", rounded, "50.001.236.020.998.000.000"]) {
      expect(isImpreciseNumber(cell), cell).toBe(true);
      expect(cnjOf(cell), cell).toBeNull();
    }
    // A lawsuit's number with its mask, or whole without it, is what it says.
    for (const cell of [formatCnj(GOIAS) ?? "", GOIAS, String(BigInt(LEADING)), "2026", ""]) {
      expect(isImpreciseNumber(cell), cell).toBe(false);
    }
  });

  it("counts its days from 1900 or from 1904, and knows a number that is no day", () => {
    expect(excelDate(46237, false)).toBe("2026-08-03");
    expect(excelDate(1, false)).toBe("1900-01-01");
    expect(excelDate(59, false)).toBe("1900-02-28");
    expect(excelDate(61, false)).toBe("1900-03-01");
    expect(excelDate(44775, true)).toBe("2026-08-03");
    expect(excelDate(-1, false)).toBeNull();
    expect(excelDate(Number.NaN, false)).toBeNull();
  });

  it("refuses a zip that is no workbook, and bytes that are no zip", () => {
    expect(readXlsx(zipSync({ "leia-me.txt": strToU8("nada") }))).toEqual({ ok: false, code: "not_a_workbook" });
    expect(readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]))).toEqual({ ok: false, code: "not_a_workbook" });
    expect(readXlsx(workbook('<row r="1"><c r="A1" t="inlineStr"><is><t>Só cabeçalho</t></is></c></row>'))).toEqual({
      ok: false,
      code: "no_rows",
    });
  });

  it("is read through the same door as a text export, with the headers found under a title", () => {
    const bytes = workbook(
      [
        '<row r="1"><c r="A1" t="inlineStr"><is><t>Souza Advogados</t></is></c><c r="B1" t="inlineStr"><is><t>Emitido em 10/10/2026</t></is></c></row>',
        '<row r="2"><c r="A2" t="inlineStr"><is><t>Processo</t></is></c><c r="B2" t="inlineStr"><is><t>Cliente</t></is></c><c r="C2" t="inlineStr"><is><t>CPF</t></is></c></row>',
        `<row r="3"><c r="A3" t="inlineStr"><is><t>${formatCnj(GOIAS)}</t></is></c><c r="B3" t="inlineStr"><is><t>Maria Teste</t></is></c></row>`,
      ].join(""),
    );
    const read = readSpreadsheet(bytes, { headerScore: portfolioHeaderScore });
    expect(read.ok && read.table.headers).toEqual(["Processo", "Cliente", "CPF"]);
    expect(read.ok && read.table.lines).toEqual([3]);
  });
});

describe("a day as a spreadsheet writes it", () => {
  it("is read day first, as Brazil writes it, unless the column says otherwise", () => {
    expect(parseDateValue("03/08/2026")).toBe("2026-08-03");
    expect(parseDateValue("3-8-26")).toBe("2026-08-03");
    expect(parseDateValue("03.08.2026 14:30")).toBe("2026-08-03");
    expect(parseDateValue("2026-08-03 18:00")).toBe("2026-08-03");
    expect(parseDateValue("31/02/2026")).toBeNull();
    expect(parseDateValue("ontem")).toBeNull();
    expect(resolveDateOrder(["03/08/2026", "25/08/2026"])).toBe("day-first");
    expect(resolveDateOrder(["08/25/2026", "08/03/2026"])).toBe("month-first");
    expect(resolveDateOrder(["03/08/2026", "05/06/2026"])).toBe("day-first");
    expect(parseDateValue("08/25/2026", "month-first")).toBe("2026-08-25");
  });
});

describe("which column is which fact", () => {
  it("is guessed from the headers a system uses, each column once", () => {
    const headers = [
      "Pasta",
      "Número do Processo",
      "Cliente",
      "CPF/CNPJ",
      "Parte contrária",
      "Vara",
      "Comarca",
      "Data de distribuição",
      "Status",
      "Responsável",
      "Valor da causa",
      "Observações",
    ];
    expect(guessColumnMapping(headers)).toEqual({
      folder: 0,
      cnj: 1,
      client_name: 2,
      client_document: 3,
      opponent: 4,
      unit: 5,
      comarca: 6,
      filed_on: 7,
      status: 8,
      responsible: 9,
      claim_value: 10,
      notes: 11,
    });
    expect(normalizeHeader("  Nº do  Processo (CNJ) ")).toBe("n do processo cnj");
    // Other names for the same things, and a header that says nothing.
    const other = guessColumnMapping(["Processo", "Autor", "Cliente CPF", "", "Réu", "Órgão julgador", "Ajuizamento"]);
    expect(other).toMatchObject({ cnj: 0, client_name: 1, client_document: 2, opponent: 4, unit: 5, filed_on: 6 });
    expect(missingRequired(other)).toEqual([]);
    expect(missingRequired(guessColumnMapping(["Código", "Título"]))).toEqual(["cnj", "client_name"]);
  });
});

describe("one person's name, written two ways", () => {
  it("is told however it is written, and two people's are never taken for one", () => {
    const pairs: [string, string, boolean][] = [
      ["Maria Teste", "MARIA TESTE DA SILVA", true],
      ["Maria  teste", "Maria Teste", true],
      ["João da Silva", "Joao Silva", true],
      ["J. Silva", "João Silva", true],
      ["Ana", "Ana Paula Souza", true],
      ["Maria Teste", "Pedro Teste", false],
      ["Maria Silva", "Maria Santos", false],
      ["Maria D'Ávila", "MARIA DAVILA", true],
      ["Maria D'Ávila", "Maria Dantas", false],
      ["Maria", "Mariana", false],
      ["", "Maria", false],
      ["da", "de", false],
    ];
    // The same table as the database's own test of `import_names_match` (0035).
    for (const [first, second, same] of pairs) {
      expect(namesMatch(first, second), `${first} / ${second}`).toBe(same);
      expect(namesMatch(second, first), `${second} / ${first}`).toBe(same);
    }
  });

  it("reads a name's letters as the database's slugify does", () => {
    const init = fs.readFileSync(
      path.resolve(__dirname, "../../../../../packages/db/migrations/0000_init.sql"),
      "utf8",
    );
    const translated = /translate\(\s*lower\(value\),\s*'([^']+)',\s*'([^']+)'/.exec(init);
    expect(translated?.[1]).toBe(SLUG_FROM);
    expect(translated?.[2]).toBe(SLUG_TO);
    expect([...SLUG_FROM]).toHaveLength([...SLUG_TO].length);
    // A letter slugify does not know splits the word, in the database as here.
    expect(nameWords("Søren Thiện D'Ávila da Silva-Souza")).toEqual(["soren", "thi", "n", "davila", "silva", "souza"]);
  });
});

describe("a firm's portfolio, line by line", () => {
  const courts = [
    { acronym: "TJGO", segment: "8", code: "09" },
    { acronym: "TJSP", segment: "8", code: "26" },
  ];
  // As the baseline has them: the name people know each by, and the names the courts write (0021, 0032).
  const airlines = [
    { iata: "G3", name: "Gol", names: ["VRG"] },
    { iata: "AD", name: "Azul" },
    { iata: "LA", name: "LATAM", names: ["TAM", "LATAM Airlines", "LATAM Brasil", "LATAM Airlines Brasil"] },
    { iata: "JJ", name: "LATAM Brasil" },
    { iata: "2Z", name: "Voepass", names: ["Passaredo"] },
    { iata: "TP", name: "TAP Air Portugal", names: ["Transportes Aéreos Portugueses"] },
    { iata: "AA", name: "American Airlines" },
    { iata: "DL", name: "Delta Air Lines" },
    { iata: "AF", name: "Air France" },
    { iata: "H2", name: "Sky Airline" },
    { iata: "AV", name: "Avianca" },
    { iata: "O6", name: "Avianca Brasil", names: ["Oceanair", "Avianca Brasil"], active: false },
  ];
  const headers = [
    "Processo",
    "Cliente",
    "CPF",
    "Parte contrária",
    "Vara",
    "Comarca",
    "Distribuição",
    "Status",
    "Pasta",
  ];
  const mapping = guessColumnMapping(headers);
  const preview = (rows: string[][], more: Partial<PreviewInput> = {}) =>
    buildPortfolioPreview({
      table: { headers, rows, lines: rows.map((_, index) => index + 2), format: "csv", sheet: null },
      mapping,
      existing: new Set(),
      courts,
      airlines,
      source: "Astrea",
      today: "2026-10-11",
      oldestDay: "1990-01-01",
      ...more,
    });
  const line = (
    cnj: string,
    client: string,
    more: Partial<Record<"cpf" | "opponent" | "filed" | "status", string>> = {},
  ) => [cnj, client, more.cpf ?? "", more.opponent ?? "", "", "", more.filed ?? "", more.status ?? "", ""];

  it("reads a lawsuit's number with or without its mask, and gives back the zeros a spreadsheet took", () => {
    expect(cnjOf(formatCnj(GOIAS) ?? "")).toBe(GOIAS);
    expect(cnjOf(` ${GOIAS} `)).toBe(GOIAS);
    expect(LEADING.startsWith("00")).toBe(true);
    expect(cnjOf(String(BigInt(LEADING)))).toBe(LEADING);
    expect(cnjOf("5000123-00.2099.8.09.0051")).toBeNull();
    expect(cnjOf("123")).toBeNull();
  });

  it("names the airline a party is, by the company's names in court first, when one airline answers", () => {
    const cases: [string, string | null][] = [
      ["GOL LINHAS AEREAS S.A.", "G3"],
      ["GOL", "G3"],
      ["VRG Linhas Aéreas S/A", "G3"],
      ["Azul Linhas Aéreas Brasileiras S/A", "AD"],
      // The company that answers for LATAM in Brazil, under each of its names, is one airline.
      ["TAM LINHAS AEREAS S/A", "LA"],
      ["TAM Linhas Aéreas S.A. (LATAM Brasil)", "LA"],
      ["TAM Linhas Aéreas S.A. (LATAM Airlines Brasil)", "LA"],
      ["LATAM AIRLINES GROUP S/A", "LA"],
      ["LATAM Brasil", "LA"],
      ["Passaredo Transportes Aéreos S.A.", "2Z"],
      ["TAP - Transportes Aéreos Portugueses, S.A.", "TP"],
      ["Société Air France", "AF"],
      // By the airline's own word, where the party's name says it is an airline.
      ["Delta Airlines Inc", "DL"],
      // A name of one word, or an airline's own word, counts only for an airline: none of these is one.
      ["AZUL COMPANHIA DE SEGUROS GERAIS", null],
      ["SKY SERVICOS DE BANDA LARGA LTDA", null],
      ["AMERICAN EXPRESS DO BRASIL", null],
      ["TAM Viagens e Turismo", null],
      // Two airlines named in one party are none, the company in court of one of them too.
      ["LATAM Airlines Brasil e Gol Linhas Aéreas", null],
      ["TAM Linhas Aéreas S.A. e Azul Linhas Aéreas Brasileiras S.A.", null],
      // An airline that no longer flies is none, never another of a like name.
      ["Oceanair Linhas Aéreas S/A (Avianca Brasil)", null],
      ["Avianca Brasil (Oceanair)", null],
      ["Aerovias del Continente Americano S.A. Avianca", "AV"],
      // A word inside another is not the word; two airlines in one name are none; nothing is nothing.
      ["Golden Viagens Ltda", null],
      ["Tamoio Turismo", null],
      ["Gol e Azul", null],
      ["Agência de Viagens Teste Ltda", null],
      ["", null],
    ];
    for (const [party, airline] of cases) expect(airlineOf(party, airlines), party).toBe(airline);
  });

  it("opens a case for a line it can read, with what the old system said of it", () => {
    const { rows, summary } = preview([
      [
        formatCnj(GOIAS) ?? "",
        "  Maria   Teste ",
        "123.456.789-09",
        "Gol Linhas Aéreas S.A.",
        "3º Juizado Especial Cível",
        "Goiânia",
        "03/08/2026",
        "Ativo",
        "A-12",
      ],
      [
        SAO_PAULO,
        "João Teste",
        "",
        "Azul Linhas Aéreas",
        "2ª Vara Cível",
        "São Paulo",
        "",
        "Arquivado definitivamente",
        "",
      ],
    ]);
    expect(summary).toEqual({ create: 2, exists: 0, duplicate: 0, error: 0 });
    expect(rows[0].row).toEqual({
      row: 2,
      cnj: GOIAS,
      client_name: "Maria Teste",
      cpf: "12345678909",
      airline: "G3",
      kind: "juizado",
      court: "TJGO",
      unit: "3º Juizado Especial Cível",
      comarca: "Goiânia",
      filed_on: "2026-08-03",
      closed: false,
      summary: "Importado de Astrea · Pasta: A-12 · Parte contrária: Gol Linhas Aéreas S.A. · Situação: Ativo",
    });
    expect(rows[1].row).toMatchObject({
      court: "TJSP",
      kind: "comum",
      closed: true,
      cpf: null,
      filed_on: null,
      airline: "AD",
    });
  });

  it("takes a lawsuit for ended only by words that say it ended for the firm, and says which it read so", () => {
    for (const status of [
      "Arquivado",
      "Arquivado definitivamente",
      "Arquivamento definitivo",
      "Baixado",
      "Baixa definitiva",
      "Baixado e arquivado",
      "ENCERRADO",
      "Extinto",
      "Extinta a execução",
      "Finalizado",
      "Concluído",
    ]) {
      expect(endedBy(status), status).toBe(true);
    }
    for (const status of [
      // Archived for a while, suspended, waiting, sent to another instance, reopened, denied.
      "Arquivado provisoriamente",
      "Arquivamento provisório",
      "Suspenso - arquivado provisoriamente (Tema 1417)",
      "Sobrestado",
      "Aguardando arquivamento",
      "Baixado à origem",
      "Baixado ao 1º grau",
      "Remetido à instância de origem",
      "Desarquivado",
      "Não arquivado",
      "Não foi arquivado",
      "Processo não está arquivado",
      // A final judgment has its enforcement ahead, and a lawsuit with the judge has not ended.
      "Transitado em julgado",
      "Concluso para sentença",
      "Ativo",
      "Em andamento",
      "",
    ]) {
      expect(endedBy(status), status).toBe(false);
    }
    const read = preview([
      line(GOIAS, "Maria Teste", { status: "Arquivado" }),
      line(SAO_PAULO, "João Teste", { status: "ARQUIVADO" }),
      line(LEADING, "Ana Teste", { status: "Baixado" }),
    ]);
    expect(read.endedStatuses).toEqual([
      { label: "Arquivado", lines: 2 },
      { label: "Baixado", lines: 1 },
    ]);
  });

  it("does nothing for a lawsuit the firm already has or the file repeats, and says why a line cannot be read", () => {
    const { rows, summary, problems } = preview(
      [
        line(GOIAS, "Maria Teste"),
        line(formatCnj(GOIAS) ?? "", "Maria Teste"),
        line(SAO_PAULO, "João Teste"),
        line("", "Sem número"),
        line("5000123-00.2099.8.09.0051", "Número errado"),
        line("5,12346E+19", "Número cortado"),
        line(FEDERAL, "Outra justiça"),
        line(LEADING, ""),
      ],
      { existing: new Set([SAO_PAULO]) },
    );
    expect(rows.map((row) => [row.action, row.error])).toEqual([
      ["create", null],
      ["duplicate", null],
      ["exists", null],
      ["error", "missing_cnj"],
      ["error", "invalid_cnj"],
      ["error", "imprecise_cnj"],
      ["error", "court_not_known"],
      ["error", "missing_client"],
    ]);
    expect(summary).toEqual({ create: 1, exists: 1, duplicate: 1, error: 5 });
    expect(problems).toEqual({
      missing_cnj: 1,
      invalid_cnj: 1,
      imprecise_cnj: 1,
      court_not_known: 1,
      missing_client: 1,
    });
    expect(rows.every((row) => (row.action === "create") === (row.row !== null))).toBe(true);
  });

  it("leaves out of a line what is not what it says, and goes on", () => {
    const { rows, problems } = preview([
      line(GOIAS, "Maria Teste", { cpf: "111.111.111-11", filed: "31/02/2026" }),
      line(SAO_PAULO, "Empresa Teste Ltda", { cpf: "12.345.678/0001-95", filed: "01/01/2030" }),
      // An old system writes "01/01/1900" for no day at all: a day before the oldest one is none.
      line(LEADING, "Ana Teste", { filed: "01/01/1900" }),
    ]);
    expect(rows[0]).toMatchObject({ action: "create", warnings: ["invalid_cpf", "invalid_date"] });
    expect(rows[0].row).toMatchObject({ cpf: null, filed_on: null });
    expect(rows[1]).toMatchObject({ action: "create", warnings: ["company_document", "future_date"] });
    expect(rows[2]).toMatchObject({ action: "create", warnings: ["old_date"] });
    expect(rows[2].row).toMatchObject({ filed_on: null });
    expect(problems).toEqual({ invalid_cpf: 1, invalid_date: 1, company_document: 1, future_date: 1, old_date: 1 });
  });

  it("gives a CPF to the name most of its lines carry, and a line of another name goes without it", () => {
    const { rows, problems } = preview([
      // Her son's lawsuit, filed under her CPF and listed first: the CPF is still hers.
      line(LEADING, "Pedro Teste", { cpf: "123.456.789-09" }),
      line(GOIAS, "Maria Teste", { cpf: "123.456.789-09" }),
      // The same client, written in full: the same CPF.
      line(SAO_PAULO, "MARIA TESTE DA SILVA", { cpf: "12345678909" }),
    ]);
    expect(rows.map((row) => row.row?.cpf)).toEqual([null, "12345678909", "12345678909"]);
    expect(rows[0]).toMatchObject({ warnings: ["cpf_other_name"], clientName: "Pedro Teste" });
    expect(problems).toEqual({ cpf_other_name: 1 });
    // On a tie, the first name; a CPF that is none, or a line with no name, counts for nobody.
    expect(
      cpfOwnersOf([
        ["123.456.789-09", "Pedro Teste"],
        ["12345678909", "Maria Teste"],
        ["111.111.111-11", "Ana Teste"],
        ["52998224725", ""],
      ]),
    ).toEqual(new Map([["12345678909", "Pedro Teste"]]));
  });

  it("lists how each other party was read, and takes the airline a person chose for it", () => {
    const rows = [
      line(GOIAS, "Maria Teste", { opponent: "GOL LINHAS AEREAS S/A" }),
      line(SAO_PAULO, "João Teste", { opponent: "Gol Linhas Aéreas S.A." }),
      line(LEADING, "Ana Teste", { opponent: "Oceanair Linhas Aéreas S/A" }),
    ];
    const read = preview(rows);
    expect(read.opponents).toEqual([
      { key: "gol linhas aereas s a", label: "GOL LINHAS AEREAS S/A", lines: 2, recognized: "G3", airline: "G3" },
      {
        key: "oceanair linhas aereas s a",
        label: "Oceanair Linhas Aéreas S/A",
        lines: 1,
        recognized: null,
        airline: null,
      },
    ]);
    expect(read.rows.map((row) => row.opponentKey)).toEqual([
      "gol linhas aereas s a",
      "gol linhas aereas s a",
      "oceanair linhas aereas s a",
    ]);
    const chosen = withAirlineChoices(
      read,
      new Map<string, string | null>([
        ["gol linhas aereas s a", null],
        ["oceanair linhas aereas s a", "AD"],
      ]),
    );
    expect(withAirlineChoices(read, new Map())).toBe(read);
    expect(chosen.rows.map((row) => row.row?.airline)).toEqual([null, null, "AD"]);
    expect(chosen.opponents.map((opponent) => [opponent.recognized, opponent.airline])).toEqual([
      ["G3", null],
      [null, "AD"],
    ]);
  });
});
