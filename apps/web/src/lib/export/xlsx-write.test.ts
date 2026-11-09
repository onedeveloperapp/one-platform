import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { columnName, excelSerial, sheetName, writeWorkbook, writeXlsx } from "@/lib/export/xlsx-write";
import { readXlsx } from "@/lib/import/xlsx";

describe("a workbook of several sheets", () => {
  const parts = (bytes: Uint8Array) =>
    Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, part]) => [name, strFromU8(part)]));

  it("writes each sheet under its own name, in order, the first being what opens", () => {
    const bytes = writeWorkbook([
      { sheet: "Sobre este arquivo", columns: [{ title: "Carteira" }], rows: [["Lima Advocacia"]], plain: true },
      {
        sheet: "Clientes",
        columns: [{ title: "Nome" }, { title: "Casos", kind: "number" }],
        rows: [["Maria Teste", 2]],
      },
      { sheet: "Ações", columns: [{ title: "Número" }], rows: [] },
    ]);
    const files = parts(bytes);
    expect(
      [...files["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)" sheetId="(\d)" r:id="rId(\d)"/g)].map((m) =>
        m.slice(1),
      ),
    ).toEqual([
      ["Sobre este arquivo", "1", "1"],
      ["Clientes", "2", "2"],
      ["Ações", "3", "3"],
    ]);
    for (const at of [1, 2, 3]) {
      expect(files["[Content_Types].xml"]).toContain(`/xl/worksheets/sheet${at}.xml`);
      expect(files["xl/_rels/workbook.xml.rels"]).toContain(`Id="rId${at}"`);
    }
    expect(files["xl/_rels/workbook.xml.rels"]).toContain('Id="rId4"');
    expect(files["xl/worksheets/sheet2.xml"]).toContain("Maria Teste");
    expect(files["xl/worksheets/sheet2.xml"]).toContain("<v>2</v>");
    // A sheet that only says something takes no filter; the others do, an empty one included.
    expect(files["xl/worksheets/sheet1.xml"]).not.toContain("autoFilter");
    expect(files["xl/worksheets/sheet3.xml"]).toContain('<autoFilter ref="A1:A1"/>');
    // What the import reads back is the first sheet.
    expect(readXlsx(bytes)).toMatchObject({
      ok: true,
      table: { headers: ["Carteira"], rows: [["Lima Advocacia"]] },
    });
  });

  it("never gives two sheets one name, which Excel refuses, whatever their case", () => {
    const files = parts(
      writeWorkbook([
        { sheet: "Casos", columns: [], rows: [] },
        { sheet: "casos", columns: [], rows: [] },
        { sheet: "x".repeat(40), columns: [], rows: [] },
        { sheet: "x".repeat(40), columns: [], rows: [] },
      ]),
    );
    expect([...files["xl/workbook.xml"].matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1])).toEqual([
      "Casos",
      "casos 2",
      "x".repeat(31),
      `${"x".repeat(29)} 2`,
    ]);
  });
});

describe("what the writer writes", () => {
  it("names the columns as Excel does", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("counts days as Excel does, and refuses a day the calendar does not have", () => {
    expect(excelSerial("1900-03-01")).toBe(61);
    expect(excelSerial("2026-11-08")).toBe(46334);
    expect(excelSerial("2026-11-08 12:00")).toBe(46334.5);
    expect(excelSerial("2026-02-30")).toBeNull();
    expect(excelSerial("ontem")).toBeNull();
  });

  it("gives a sheet a name Excel takes", () => {
    expect(sheetName("Casos: 1/2 [teste]")).toBe("Casos 1 2 teste");
    expect(sheetName("x".repeat(40))).toHaveLength(31);
    expect(sheetName("  /  ")).toBe("Planilha");
  });
});

describe("a workbook read back", () => {
  const bytes = writeXlsx({
    sheet: "Casos",
    columns: [
      { title: "Caso", kind: "number" },
      { title: "Cliente" },
      { title: "Processo" },
      { title: "Data do voo", kind: "date" },
      { title: "Último movimento", kind: "moment" },
    ],
    rows: [
      [41, "João & Maria <teste>", "0005101-68.2099.8.09.0051", "2026-10-07", "2026-11-08 09:30"],
      [42, "=1+1", null, null, null],
      [43, "Ana\u0007 Lima", "12345678901234567890", "dia nenhum", ""],
    ],
  });
  const read = readXlsx(bytes);
  if (!read.ok) throw new Error(`not read: ${read.code}`);
  const { table } = read;

  it("holds the titles and every line, in order", () => {
    expect(table.headers).toEqual(["Caso", "Cliente", "Processo", "Data do voo", "Último movimento"]);
    expect(table.rows.map((row) => row[0])).toEqual(["41", "42", "43"]);
  });

  it("keeps a text as it is, escaped and with no control character, never read as a formula", () => {
    expect(table.rows[0][1]).toBe("João & Maria <teste>");
    expect(table.rows[1][1]).toBe("=1+1");
    expect(table.rows[2][1]).toBe("Ana Lima");
  });

  it("keeps a long number as text, whole", () => {
    expect(table.rows[2][2]).toBe("12345678901234567890");
  });

  it("writes days and moments as Excel's dates, and what is not one as a text", () => {
    expect(table.rows[0][3]).toBe("2026-10-07");
    expect(table.rows[0][4]).toBe("2026-11-08 09:30");
    expect(table.rows[1][3]).toBe("");
    expect(table.rows[2][3]).toBe("dia nenhum");
  });
});
