import { moneyStatementDocument } from "./money-statement";
import { describe, expect, it } from "vitest";

const facts = {
  firm: "Lima Advocacia",
  firmDocument: "11222333000181",
  person: "Maria Teste de Oliveira",
  personCpf: "52998224725",
  minor: false,
  caseSeq: 7,
  cnj: "10003012720998090100",
  court: "TJGO",
  path: "firm" as const,
  releasedCents: 1023450,
  releasedOn: "2026-11-06",
  grossCents: 1023450,
  feesCents: 307035,
  feesPercent: 30,
  costsCents: 20000,
  heldCents: 0,
  held: [],
  payableCents: 696415,
  paidOn: "2026-11-09",
  account: { kind: "pix" as const, ends: "4725" },
  issuedOn: "2026-11-10",
};

const text = (value: ReturnType<typeof moneyStatementDocument>) => JSON.stringify(value.blocks);

describe("the accountability statement (0156)", () => {
  it("says what the court released, the client's part, what the firm kept and why, and what was passed on", () => {
    const written = moneyStatementDocument(facts);
    expect(written.title).toBe("Prestação de contas do caso nº 7");
    const words = text(written);
    expect(words).toContain("Maria Teste de Oliveira, CPF nº 529.982.247-25");
    expect(words).toContain("1000301-27.2099.8.09.0100 (TJGO)");
    expect(words).toContain("(30% conforme o contrato de honorários)");
    expect(words).toContain("Custos reembolsados ao escritório");
    expect(words).toContain("Repassado a você");
    expect(words).toContain("em 09/11/2026");
    expect(words).toContain("Pix na chave do seu CPF, final 4725");
    expect(words).toContain("nunca pede pagamento para liberar um valor");
  });

  it("says a held part with why, and a part the court paid straight to the client", () => {
    const words = text(
      moneyStatementDocument({
        ...facts,
        path: "direct",
        held: [{ reason: "no_clause", cents: 100000 }],
        heldCents: 100000,
        account: null,
      }),
    );
    expect(words).toContain("Valor retido");
    expect(words).toContain("sem autorização assinada");
    expect(words).toContain("Pago pelo juízo diretamente a você");
    expect(words).not.toContain("Conta de destino");
  });

  it("writes no dash, no exclamation and nothing of the platform", () => {
    const words = text(moneyStatementDocument(facts));
    expect(words).not.toMatch(/[–—!]/);
    expect(words).not.toMatch(/\bONE\b/);
  });
});
