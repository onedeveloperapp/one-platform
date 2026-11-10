import { countsIn, excerptIn, moneyIn, percentsIn, readFeeTermsOutput } from "./fee-terms-reading";
import { describe, expect, it } from "vitest";

// An invented fee contract of a firm, as its library keeps it: what changes per client is a mark.
const CONTRACT = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

CONTRATANTE: [[NOME]], inscrito no CPF sob o nº [[CPF]].

Cláusula 3ª. Pelos serviços, o CONTRATANTE pagará ao escritório a quantia de R$ 1.500,00 (mil e quinhentos reais) na assinatura deste contrato, e mais 3 (três) parcelas mensais de R$ 500,00 cada uma.

Cláusula 4ª. Em caso de êxito, o escritório receberá 30% (trinta por cento) do proveito econômico obtido, nunca menos que R$ 800,00. Havendo acordo, o percentual será de 25% (vinte e cinco por cento).

Cláusula 5ª. Por audiência realizada será devido o valor de R$ 300,00, e por recurso interposto em favor do CONTRATANTE, R$ 450,00.

Cláusula 6ª. O atraso no pagamento sujeitará o CONTRATANTE à multa de 2% e juros de 1% ao mês.`;

const ANSWER = {
  e_contrato_de_honorarios: true,
  entrada_centavos: 150000,
  entrada_trecho: "a quantia de R$ 1.500,00 (mil e quinhentos reais) na assinatura deste contrato",
  parcelas: 3,
  parcela_centavos: 50000,
  parcelas_trecho: "e mais 3 (três) parcelas mensais de R$ 500,00 cada uma",
  mensalidades: 0,
  mensalidade_centavos: 0,
  mensalidade_trecho: "",
  exito_percentual: 30,
  exito_minimo_centavos: 80000,
  exito_trecho: "o escritório receberá 30% (trinta por cento) do proveito econômico obtido, nunca menos que R$ 800,00",
  acordo_percentual: 25,
  acordo_trecho: "Havendo acordo, o percentual será de 25% (vinte e cinco por cento)",
  audiencia_centavos: 30000,
  audiencia_trecho: "Por audiência realizada será devido o valor de R$ 300,00",
  recurso_centavos: 45000,
  recurso_trecho: "por recurso interposto em favor do CONTRATANTE, R$ 450,00",
  multa_percentual: 2,
  juros_percentual_mes: 1,
  atraso_trecho: "à multa de 2% e juros de 1% ao mês",
  observacoes: "",
};

describe("the words of a value", () => {
  it("reads money, percents and counts as the contract writes them", () => {
    expect(moneyIn("a quantia de R$ 1.500,00 (mil e quinhentos reais)")).toContain(150000);
    expect(moneyIn("R$1500,00 e R$ 300")).toEqual(expect.arrayContaining([150000, 30000]));
    expect(percentsIn("30% (trinta por cento)")).toEqual(expect.arrayContaining([30]));
    expect(percentsIn("vinte e cinco por cento")).toContain(25);
    expect(percentsIn("2,5 % ao mês")).toContain(2.5);
    expect(countsIn("em 10 (dez) parcelas de R$ 300,00")).toEqual(expect.arrayContaining([10]));
    expect(countsIn("em 10 (dez) parcelas de R$ 300,00")).not.toContain(300);
  });

  it("finds an excerpt in the contract whatever its accents, case or spacing, and its pieces between ellipses", () => {
    expect(excerptIn("ESCRITORIO RECEBERA 30%", CONTRACT)).toBe(true);
    expect(excerptIn("Em caso de êxito ... nunca menos que R$ 800,00", CONTRACT)).toBe(true);
    expect(excerptIn("nunca menos que R$ 800,00 ... Em caso de êxito", CONTRACT)).toBe(false);
    expect(excerptIn("o escritório receberá 40% do proveito", CONTRACT)).toBe(false);
  });
});

describe("readFeeTermsOutput", () => {
  it("fills every value whose words the contract has", () => {
    const read = readFeeTermsOutput(ANSWER, CONTRACT);
    expect(read.isContract).toBe(true);
    expect(read.dropped).toEqual([]);
    expect(read.values).toEqual({
      entryCents: 150000,
      installments: 3,
      installmentCents: 50000,
      successPercent: 30,
      successMinCents: 80000,
      settlementPercent: 25,
      hearingCents: 30000,
      appealCents: 45000,
      lateFinePercent: 2,
      lateInterestPercent: 1,
    });
  });

  it("leaves out a value the contract's words do not say, and one read from words it does not have", () => {
    const read = readFeeTermsOutput(
      {
        ...ANSWER,
        entrada_centavos: 200000,
        exito_percentual: 35,
        audiencia_trecho: "Por audiência será devido R$ 300,00",
      },
      CONTRACT,
    );
    expect(read.dropped).toEqual(expect.arrayContaining(["entry", "success", "hearing"]));
    expect(read.values.entryCents).toBeUndefined();
    expect(read.values.successPercent).toBeUndefined();
    expect(read.values.hearingCents).toBeUndefined();
    // The minimum is read from the same words as the percent, and stands on its own.
    expect(read.values.successMinCents).toBe(80000);
  });

  it("fills nothing of a text that is no fee contract, and keeps the note plain", () => {
    const read = readFeeTermsOutput(
      { ...ANSWER, e_contrato_de_honorarios: false, observacoes: "É uma procuração — não um contrato!" },
      CONTRACT,
    );
    expect(read).toMatchObject({ isContract: false, read: [], values: {} });
    expect(read.note).toBe("É uma procuração, não um contrato.");
  });
});
