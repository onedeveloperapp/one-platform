import { readStatementPdfOutput } from "./statement-pdf";
import { describe, expect, it } from "vitest";

const statement = {
  tipo: "extrato",
  inicio: "2026-10-01",
  fim: "2026-10-31",
  saldo_inicial_centavos: 100_000,
  saldo_final_centavos: 238_710,
  tem_saldos: true,
  linhas: [
    { data: "2026-10-05", descricao: "PIX RECEBIDO MARIA TESTE", valor_centavos: 150_000 },
    { data: "2026-10-10", descricao: "PAGAMENTO ENERGIA", valor_centavos: -18_990 },
    { data: "2026-10-20", descricao: "TARIFA PACOTE", valor_centavos: 7_700 * -1 + 15_400 },
  ],
  observacoes: "",
};

describe("a statement or a card bill in PDF, read by ONE", () => {
  it("keeps a statement whose lines take its opening balance to its closing one", () => {
    const read = readStatementPdfOutput(statement);
    expect(read).toMatchObject({
      ok: true,
      kind: "bank",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      balance: { cents: 238_710, on: "2026-10-31" },
    });
    expect(read.ok && read.lines.map((line) => line.cents)).toEqual([150_000, -18_990, 7_700]);
  });

  it("refuses a statement one cent off, and says by how much", () => {
    expect(readStatementPdfOutput({ ...statement, saldo_final_centavos: 238_711 })).toEqual({
      ok: false,
      code: "unbalanced",
      differenceCents: -1,
    });
  });

  it("keeps a card bill whose lines, their sign turned, are its total", () => {
    const read = readStatementPdfOutput({
      tipo: "fatura",
      inicio: "",
      fim: "",
      saldo_inicial_centavos: 0,
      saldo_final_centavos: 45_090,
      tem_saldos: true,
      linhas: [
        { data: "2026-10-02", descricao: "SOFTWARE TESTE", valor_centavos: -29_900 },
        { data: "2026-10-12", descricao: "PAPELARIA TESTE", valor_centavos: -15_190 },
      ],
      observacoes: "",
    });
    expect(read).toMatchObject({ ok: true, kind: "card", balance: null, startsOn: "2026-10-02", endsOn: "2026-10-12" });
  });

  it("refuses what is no statement, a statement with no balances and a line not read whole", () => {
    expect(readStatementPdfOutput({ ...statement, tipo: "outro" })).toEqual({ ok: false, code: "not_statement" });
    expect(readStatementPdfOutput({ ...statement, tem_saldos: false })).toEqual({ ok: false, code: "no_balances" });
    expect(
      readStatementPdfOutput({
        ...statement,
        linhas: [...statement.linhas, { data: "2026-10-31", descricao: "", valor_centavos: 100 }],
      }),
    ).toEqual({ ok: false, code: "unbalanced" });
  });
});
