import { describe, expect, it } from "vitest";

import {
  occurrenceKeys,
  statementColumns,
  statementFromTable,
  statementHeaderScore,
} from "@/lib/finance/statement-table";
import { readSpreadsheet } from "@/lib/import/read";

const csv = (text: string) => new TextEncoder().encode(text);

describe("a bank statement exported as a spreadsheet (0127)", () => {
  it("finds the columns by the names banks give them", () => {
    expect(statementColumns(["Data", "Lançamento", "Ag./Origem", "Valor (R$)", "Saldos (R$)"])).toMatchObject({
      day: 0,
      memo: [1],
      amount: 3,
      balance: 4,
    });
    expect(statementColumns(["Data Lançamento", "Histórico", "Débito", "Crédito"])).toMatchObject({
      day: 0,
      memo: [1],
      debit: 2,
      credit: 3,
      amount: null,
    });
    expect(statementColumns(["Data", "Valor", "Identificador", "Descrição"])).toMatchObject({ id: 2, memo: [3] });
    expect(statementColumns(["Cliente", "Processo"])).toBeNull();
    expect(statementColumns(["Data", "Histórico"])).toBeNull();
  });

  it("reads an export of Itaú's kind under its report's title: values with their sign, the balance lines apart", () => {
    const table = readSpreadsheet(
      csv(
        [
          "Extrato conta corrente",
          "Agência 0000 Conta 99999-1",
          "data;lançamento;ag./origem;valor (R$);saldos (R$)",
          "01/10/2026;SALDO ANTERIOR;;;1.000,00",
          "03/10/2026;TED ALVARA JUDICIAL TJGO;;2.490,00;",
          "05/10/2026;PAG BOLETO ENERGIA;;-189,90;",
          "05/10/2026;TARIFA PACOTE;;-15,00;",
          "05/10/2026;TARIFA PACOTE;;-15,00;",
          "05/10/2026;SALDO DO DIA;;;3.270,10",
        ].join("\n"),
      ),
      { headerScore: statementHeaderScore },
    );
    expect(table.ok).toBe(true);
    if (!table.ok) return;
    const read = statementFromTable(table.table);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.statement.lines.map((line) => [line.postedOn, line.cents, line.memo])).toEqual([
      ["2026-10-03", 249000, "TED ALVARA JUDICIAL TJGO"],
      ["2026-10-05", -18990, "PAG BOLETO ENERGIA"],
      ["2026-10-05", -1500, "TARIFA PACOTE"],
      ["2026-10-05", -1500, "TARIFA PACOTE"],
    ]);
    expect(read.statement.balance).toEqual({ cents: 327010, on: "2026-10-05" });
    expect([read.statement.startsOn, read.statement.endsOn]).toEqual(["2026-10-03", "2026-10-05"]);
  });

  it("makes one value of a debit and a credit, and reads a D or a C beside a value", () => {
    const columns = statementFromTable({
      headers: ["Data", "Histórico", "Débito", "Crédito"],
      rows: [
        ["03/10/2026", "PIX RECEBIDO", "", "300,00"],
        ["04/10/2026", "PIX ENVIADO", "50,00", ""],
      ],
    });
    expect(columns.ok && columns.statement.lines.map((line) => line.cents)).toEqual([30000, -5000]);
    const marked = statementFromTable({
      headers: ["Data", "Histórico", "Valor"],
      rows: [
        ["03/10/2026", "DEPOSITO", "1.000,00 C"],
        ["04/10/2026", "SAQUE", "200,00 D"],
      ],
    });
    expect(marked.ok && marked.statement.lines.map((line) => line.cents)).toEqual([100000, -20000]);
    const typed = statementFromTable({
      headers: ["Data", "Histórico", "Valor", "Tipo"],
      rows: [["03/10/2026", "TARIFA", "12,00", "Débito"]],
    });
    expect(typed.ok && typed.statement.lines[0].cents).toBe(-1200);
  });

  it("keeps the export's own id of a line, and says when no line or no column can be read", () => {
    const nubank = statementFromTable({
      headers: ["Data", "Valor", "Identificador", "Descrição"],
      rows: [["03/10/2026", "-25.50", "abc-123", "Transferência enviada"]],
    });
    expect(nubank.ok && nubank.statement.lines[0]).toMatchObject({ bankId: "abc-123", cents: -2550 });
    expect(statementFromTable({ headers: ["Data", "Histórico", "Valor"], rows: [["x", "y", "z"]] })).toEqual({
      ok: false,
      code: "no_lines",
    });
    expect(statementFromTable({ headers: ["A", "B"], rows: [] })).toEqual({ ok: false, code: "columns_unknown" });
  });

  it("tells two equal payments of one file apart, and gives the same export the same keys", () => {
    const lines = [
      { bankId: null, postedOn: "2026-10-05", cents: -1500, memo: "TARIFA PACOTE" },
      { bankId: null, postedOn: "2026-10-05", cents: -1500, memo: "Tarifa  pacote" },
      { bankId: null, postedOn: "2026-10-06", cents: -1500, memo: "TARIFA PACOTE" },
    ];
    const keys = occurrenceKeys(lines);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0].endsWith("#1") && keys[1].endsWith("#2") && keys[2].endsWith("#1")).toBe(true);
    expect(occurrenceKeys(lines)).toEqual(keys);
  });
});
