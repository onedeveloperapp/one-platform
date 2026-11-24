import { cnjMasked, djenLawsuitsSheet, lawsuitsToComplete, readDjenLawsuits } from "./djen-lawsuits";
import { guessColumnMapping } from "./mapping";
import { describe, expect, it } from "vitest";

describe("the lawsuits the DJEN already shows (0208)", () => {
  const raw = {
    ok: true,
    total: 2,
    lawsuits: [
      {
        cnj: "10003012720998090100",
        court: "TJGO",
        unit: "1º Juizado Especial Cível de Goiânia",
        class_name: "Procedimento do Juizado Especial Cível",
        first_on: "2026-10-20",
        last_on: "2026-11-05",
        publications: 2,
        airline_name: "COMPANHIA AEREA DE TESTE SA",
      },
      { cnj: "123", court: "TJGO" },
    ],
  };

  it("reads the database's answer, leaving out a line that is no lawsuit", () => {
    const read = readDjenLawsuits(raw);
    expect(read?.total).toBe(2);
    expect(read?.lawsuits).toHaveLength(1);
    expect(read?.lawsuits[0]).toMatchObject({ cnj: "10003012720998090100", publications: 2, lastOn: "2026-11-05" });
    expect(readDjenLawsuits({ ok: false, code: "not_allowed" })).toBeNull();
  });

  it("leaves out of the spreadsheet what ONE is opening by itself, and keeps what it left (0287)", () => {
    const read = readDjenLawsuits({
      ok: true,
      total: 3,
      lawsuits: [
        { cnj: "28710012820998090051", court: "TJGO", publications: 1, one: "opening" },
        { cnj: "28710021320998090051", court: "TJGO", publications: 1, one: "firm_on_defense" },
        { cnj: "28710039520998090051", court: "TJGO", publications: 1, one: "Não é um código" },
      ],
    });
    expect(read?.lawsuits.map((lawsuit) => lawsuit.one)).toEqual(["opening", "firm_on_defense", null]);
    expect(lawsuitsToComplete(read?.lawsuits ?? []).map((lawsuit) => lawsuit.cnj)).toEqual([
      "28710021320998090051",
      "28710039520998090051",
    ]);
  });

  it("writes the number as the court writes it", () => {
    expect(cnjMasked("10003012720998090100")).toBe("1000301-27.2099.8.09.0100");
  });

  it("writes a spreadsheet the import reads by its own column names, the client left for the firm", () => {
    const sheet = djenLawsuitsSheet(readDjenLawsuits(raw)?.lawsuits ?? []);
    const mapping = guessColumnMapping(sheet.columns.map((column) => column.title));
    expect(mapping.cnj).toBe(0);
    expect(mapping.client_name).toBe(1);
    expect(mapping.client_document).toBe(2);
    expect(mapping.opponent).toBe(3);
    expect(mapping.unit).toBe(4);
    expect(sheet.rows[0]?.[0]).toBe("1000301-27.2099.8.09.0100");
    expect(sheet.rows[0]?.[1]).toBeNull();
    expect(sheet.rows[0]?.[6]).toBe("TJGO: 2 publicações no DJEN, a última em 05/11/2026");
  });
});
