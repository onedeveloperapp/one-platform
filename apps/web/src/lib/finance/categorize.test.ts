import { describe, expect, it } from "vitest";

import { categorizeBriefing, categorizeFailure, categorizeInputOf, maskMemo } from "@/lib/finance/categorize";

describe("what the AI is handed of a statement's lines (0128)", () => {
  it("takes out what identifies a person or an account, and keeps what says what the line is", () => {
    expect(maskMemo("PIX RECEBIDO 123.456.789-09 MARIA")).toBe("PIX RECEBIDO [CPF] MARIA");
    expect(maskMemo("TED 12.345.678/0001-95 ENERGIA SA")).toBe("TED [CNPJ] ENERGIA SA");
    // An agency of four digits says nothing of anybody; an account's number is taken out.
    expect(maskMemo("TRANSF AG 0341 CC 99999-1")).toBe("TRANSF AG 0341 CC [número]");
    // A long run of digits goes, whatever mark it takes.
    expect(maskMemo("DOC 0012345678 FORNECEDOR")).toMatch(/^DOC \[[a-zú]+\] FORNECEDOR$/);
    expect(maskMemo("TARIFA PACOTE SERVICOS")).toBe("TARIFA PACOTE SERVICOS");
    expect(maskMemo("contato@exemplo.invalid")).toBe("[e-mail]");
  });

  it("numbers the chart and the lines, each value in reais with its sign", () => {
    const briefing = categorizeBriefing({
      categories: [
        { n: 1, kind: "income", name: "Honorários contratuais" },
        { n: 2, kind: "expense", name: "Tarifas bancárias e juros" },
      ],
      lines: [
        { n: 1, postedOn: "2026-11-01", cents: -3590, memo: "TARIFA PACOTE" },
        { n: 2, postedOn: "2026-11-02", cents: 50000, memo: "" },
      ],
    });
    expect(briefing).toContain("1. receita: Honorários contratuais");
    expect(briefing).toContain("2. despesa: Tarifas bancárias e juros");
    expect(briefing).toContain("1. 2026-11-01 · -R$ 35,90 · TARIFA PACOTE");
    expect(briefing).toContain("2. 2026-11-02 · R$ 500,00 · (sem histórico)");
  });

  it("reads the database's answer, and nothing when the claim is gone", () => {
    expect(categorizeInputOf(null)).toBeNull();
    expect(
      categorizeInputOf({
        org_id: "o",
        statement_id: "s",
        claim: 2,
        categories: [{ n: 1, kind: "income", name: "A" }],
        lines: [{ n: 1, posted_on: "2026-11-01", cents: "-100", memo: "X" }],
      }),
    ).toEqual({
      orgId: "o",
      statementId: "s",
      claim: 2,
      categories: [{ n: 1, kind: "income", name: "A" }],
      lines: [{ n: 1, postedOn: "2026-11-01", cents: -100, memo: "X" }],
    });
  });

  it("tells a model that answered badly from a provider that is out", () => {
    expect(categorizeFailure("output_invalid")).toBe("retry");
    expect(categorizeFailure("provider_unavailable")).toBe("released");
  });
});
