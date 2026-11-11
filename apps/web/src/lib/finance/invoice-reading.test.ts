import { invoiceBriefing, readInvoiceOutput } from "./invoice-reading";
import { describe, expect, it } from "vitest";

describe("the invoice the firm issued, read by ONE", () => {
  const today = "2026-11-10";

  it("keeps its number as printed, its day and whether its value is the fee's", () => {
    expect(
      readInvoiceOutput(
        {
          e_nota_de_servico: true,
          numero: " 2026. 000123 ",
          data_emissao: "2026-11-05",
          valor_centavos: 150_000,
          tomador: "Maria Teste",
          codigo_verificacao: "AB12-CD34",
          observacoes: "",
        },
        { today, entryCents: 150_000 },
      ),
    ).toEqual({
      isInvoice: true,
      number: "2026000123",
      issuedOn: "2026-11-05",
      cents: 150_000,
      taker: "Maria Teste",
      code: "AB12-CD34",
      matches: true,
      note: "",
    });
  });

  it("says a value that is not the fee's, and leaves out a day still to come", () => {
    const read = readInvoiceOutput(
      { e_nota_de_servico: true, numero: "77", data_emissao: "2026-12-01", valor_centavos: 120_000 },
      { today, entryCents: 150_000 },
    );
    expect(read).toMatchObject({ number: "77", issuedOn: "", matches: false });
  });

  it("reads no value as unknown, never as another fee", () => {
    expect(readInvoiceOutput({ e_nota_de_servico: false }, { today, entryCents: 150_000 })).toMatchObject({
      isInvoice: false,
      cents: 0,
      matches: null,
    });
  });

  it("tells the model the fee the invoice is of, in reais", () => {
    expect(invoiceBriefing(150_000)).toContain("1500,00 reais");
  });
});
