import { financeDocumentBriefing, readFinanceDocumentOutput } from "./documents";
import { describe, expect, it } from "vitest";

import { cobrancaBarcode, cobrancaLine, factorOf } from "@flyee/rules/boleto";

// Every company, value and line here is invented.
const categories = [
  { id: "cat-power", name: "Energia, água e telefone" },
  { id: "cat-rent", name: "Aluguel" },
];
const today = "2026-11-10";

function line(due: string, cents: number): string {
  const head = `3419${String(factorOf(due)).padStart(4, "0")}${String(cents).padStart(10, "0")}`;
  return cobrancaLine(cobrancaBarcode(head + "1090000000017654321000".padEnd(25, "0")));
}

const answer = (changes: Record<string, unknown> = {}) => ({
  tipo: "conta_consumo",
  legivel: true,
  favorecido: "Energia Teste S.A.",
  pagador: "Lima Advocacia",
  valor_centavos: 18990,
  vencimento: "2026-11-20",
  competencia: "2026-10",
  data_pagamento: "",
  linha_digitavel: "",
  descricao: "Energia elétrica do escritório, outubro",
  categoria: 1,
  observacoes: "",
  ...changes,
});

describe("a document of the books read by ONE", () => {
  it("fills what it says, the category by its number in the chart it was given", () => {
    const read = readFinanceDocumentOutput(answer(), { categories, today });
    expect(read).toMatchObject({
      kind: "conta_consumo",
      counterparty: "Energia Teste S.A.",
      cents: 18990,
      dueOn: "2026-11-20",
      competence: "2026-10",
      categoryId: "cat-power",
      typedLine: null,
      lineFailed: false,
      dropped: [],
    });
  });

  it("gives a typed line that checks the last word on the value and the due day", () => {
    const read = readFinanceDocumentOutput(
      answer({ linha_digitavel: line("2026-11-25", 19990), valor_centavos: 18990, vencimento: "2026-11-20" }),
      { categories, today },
    );
    expect(read.typedLine).toHaveLength(47);
    expect(read.barcode).toHaveLength(44);
    expect(read.cents).toBe(19990);
    expect(read.dueOn).toBe("2026-11-25");
    expect(read.valueFromLine).toBe(true);
  });

  it("keeps no line that does not check, and says so", () => {
    const good = line("2026-11-25", 19990);
    const wrong = good.slice(0, 2) + ((Number(good[2]) + 1) % 10) + good.slice(3);
    const read = readFinanceDocumentOutput(answer({ linha_digitavel: wrong }), { categories, today });
    expect(read.typedLine).toBeNull();
    expect(read.lineFailed).toBe(true);
    expect(read.cents).toBe(18990);
  });

  it("leaves out a value, a day or a month that is not one, and a category it was not given", () => {
    const read = readFinanceDocumentOutput(
      answer({
        valor_centavos: -5,
        vencimento: "2026-02-30",
        competencia: "2026-13",
        data_pagamento: "ontem",
        categoria: 9,
      }),
      { categories, today },
    );
    expect(read.cents).toBeNull();
    expect(read.dueOn).toBeNull();
    expect(read.competence).toBeNull();
    expect(read.paidOn).toBeNull();
    expect(read.categoryId).toBeNull();
    expect(read.dropped).toEqual(["cents", "dueOn", "competence", "paidOn"]);
  });

  it("reads a kind it does not know as another, and a day far from today as none", () => {
    const read = readFinanceDocumentOutput(answer({ tipo: "fatura", vencimento: "2049-01-10" }), { categories, today });
    expect(read.kind).toBe("outro");
    expect(read.dueOn).toBeNull();
  });

  it("tells the model the way of the money and the chart by numbers, never the categories' ids", () => {
    const briefing = financeDocumentBriefing({ direction: "pay", target: "bill", categories });
    expect(briefing).toContain("conta a pagar");
    expect(briefing).toContain("1. Energia, água e telefone");
    expect(briefing).not.toContain("cat-power");
  });
});
