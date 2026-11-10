import { directionOf, legacyBillsFromTable, legacyColumns, legacyHeaderScore, legacyNumbers } from "./legacy-bills";
import { describe, expect, it } from "vitest";

const headers = ["Tipo", "Favorecido", "Descrição", "Valor", "Vencimento", "Competência", "Categoria", "Processo"];

describe("the open bills of the system a firm used before", () => {
  it("finds each column by the name systems give it", () => {
    expect(legacyColumns(headers)).toEqual({
      direction: 0,
      counterparty: 1,
      description: 2,
      value: 3,
      due: 4,
      competence: 5,
      category: 6,
      lawsuit: 7,
      typedLine: null,
    });
    expect(legacyColumns(["Cliente", "Valor em aberto", "Data de vencimento"])).toMatchObject({
      counterparty: 0,
      value: 1,
      due: 2,
      direction: null,
    });
    expect(legacyColumns(["Nome", "Valor"])).toBeNull();
    expect(legacyHeaderScore(headers)).toBe(8);
  });

  it.each([
    ["Pagar", "pay"],
    ["Conta a pagar", "pay"],
    ["Despesa", "pay"],
    ["D", "pay"],
    ["Receber", "receive"],
    ["Receita", "receive"],
    ["C", "receive"],
    ["Outro", null],
  ])("reads %s as %s", (cell, way) => {
    expect(directionOf(cell)).toBe(way);
  });

  it("reads each line into a bill, the same key twice made two bills, and says why a line is left out", () => {
    const table = {
      headers,
      rows: [
        ["Pagar", "Imobiliária Teste", "Aluguel", "2.500,00", "10/12/2026", "12/2026", "Aluguel", ""],
        [
          "Receber",
          "Maria Teste",
          "Parcela dos honorários",
          "R$ 500,00",
          "05/12/2026",
          "",
          "",
          "1000301-27.2099.8.09.0100",
        ],
        [
          "Receber",
          "Maria Teste",
          "Parcela dos honorários",
          "R$ 500,00",
          "05/12/2026",
          "",
          "",
          "1000301-27.2099.8.09.0100",
        ],
        ["Pagar", "Energia Teste", "Conta de luz", "", "10/12/2026", "", "", ""],
        ["Pagar", "Energia Teste", "Conta de luz", "189,90", "amanhã", "", "", ""],
        ["Outro", "Papelaria Teste", "Papel", "30,00", "11/12/2026", "", "", ""],
        ["Pagar", "", "", "30,00", "11/12/2026", "", "", ""],
        ["", "", "", "", "", "", "", ""],
      ],
    };
    const read = legacyBillsFromTable(table, legacyColumns(headers)!, null);
    expect(read.bills).toHaveLength(3);
    expect(read.bills[0]).toMatchObject({
      line: 1,
      direction: "pay",
      counterparty: "Imobiliária Teste",
      cents: 250000,
      dueOn: "2026-12-10",
      competenceOn: "2026-12-01",
      category: "Aluguel",
      cnj: null,
    });
    expect(read.bills[1]).toMatchObject({ direction: "receive", cents: 50000, cnj: "10003012720998090100" });
    expect(read.bills[1].competenceOn).toBe("2026-12-01");
    expect(read.bills[1].key).not.toBe(read.bills[2].key);
    expect(read.refused).toEqual([
      { line: 4, problem: "no_value" },
      { line: 5, problem: "due_not_understood" },
      { line: 6, problem: "no_direction" },
      { line: 7, problem: "no_counterparty" },
    ]);
  });

  it("takes the way the person said where the file has none, and a negative value as one to pay", () => {
    const columns = legacyColumns(["Fornecedor", "Valor", "Vencimento"])!;
    const rows = [
      ["Imobiliária Teste", "2500", "10/12/2026"],
      ["Energia Teste", "-189,90", "10/12/2026"],
    ];
    expect(legacyBillsFromTable({ headers: [], rows }, columns, "pay").bills.map((bill) => bill.direction)).toEqual([
      "pay",
      "pay",
    ]);
    const unsaid = legacyBillsFromTable({ headers: [], rows }, columns, null);
    expect(unsaid.bills.map((bill) => [bill.counterparty, bill.cents])).toEqual([["Energia Teste", 18990]]);
    expect(unsaid.refused).toEqual([{ line: 1, problem: "no_direction" }]);
  });

  it("gives the same keys to the same file read twice", () => {
    const table = { headers, rows: [["Pagar", "Imobiliária Teste", "Aluguel", "2500", "10/12/2026", "", "", ""]] };
    const columns = legacyColumns(headers)!;
    expect(legacyBillsFromTable(table, columns, null).bills[0].key).toBe(
      legacyBillsFromTable(table, columns, null).bills[0].key,
    );
  });

  it("says what the file brings on a day", () => {
    const columns = legacyColumns(headers)!;
    const read = legacyBillsFromTable(
      {
        headers,
        rows: [
          ["Pagar", "Imobiliária Teste", "Aluguel", "2500", "10/11/2026", "", "", ""],
          ["Receber", "Maria Teste", "Honorários", "500", "10/12/2026", "", "", "1000301-27.2099.8.09.0100"],
          ["Receber", "", "", "500", "10/12/2026", "", "", ""],
        ],
      },
      columns,
      null,
    );
    expect(legacyNumbers(read, "2026-11-20")).toEqual({
      pay: { count: 1, cents: 250000 },
      receive: { count: 1, cents: 50000 },
      withCase: 1,
      late: 1,
      refused: 1,
    });
  });
});
