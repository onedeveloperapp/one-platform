import { describe, expect, it } from "vitest";

import {
  DOUBT_ASK,
  doubtAnswered,
  doubtAnswerOf,
  doubtInput,
  forecastOf,
  marketProblemOf,
  standingWords,
  withAnswer,
} from "@/lib/conversations/doubts";
import { intakeOpening } from "@/lib/conversations/intake";

// Every person and number here is invented.

const TODAY = "2099-10-23";

const FORECAST = {
  cut: { level: "all", court: null, unit: null, judge: null, airline: "AD", problem: "delay" },
  decisions: 40,
  merits: 33,
  won: 25,
  chance_percent: 76,
  outcomes: { procedente: 24, parcial: 1, improcedente: 8, acordo: 4, extinto: 3 },
  base: "media",
  from: "2099-03-01",
  to: "2099-09-30",
  min_sample: 5,
  courts: ["TJGO"],
  moral: { n: 24, p25_cents: 200000, median_cents: 300000, p75_cents: 400000 },
};

describe("a new contact's doubt", () => {
  it("weighs the problem told as the market reads it", () => {
    expect(marketProblemOf("change")).toBe("cancellation");
    expect(marketProblemOf("missed_connection")).toBe("delay");
    expect(marketProblemOf("baggage_damaged")).toBe("baggage");
    expect(marketProblemOf("overbooking")).toBe("overbooking");
    expect(marketProblemOf(undefined)).toBeNull();
    expect(marketProblemOf("downgrade")).toBeNull();
  });

  it("reads the forecast's median only, with where it comes from", () => {
    const forecast = forecastOf(FORECAST);
    expect(forecast).toEqual({
      courts: ["TJGO"],
      airline: "AD",
      problem: "delay",
      merits: 33,
      chancePercent: 76,
      medianCents: 300000,
      moralCount: 24,
      from: "2099-03-01",
      to: "2099-09-30",
    });
    expect(forecastOf(null)).toBeNull();
    expect(forecastOf({})).toBeNull();
    // A forecast with no list of courts still says the court of its cut.
    expect(forecastOf({ ...FORECAST, courts: undefined, cut: { ...FORECAST.cut, court: "TJGO" } })?.courts).toEqual([
      "TJGO",
    ]);
  });

  it("hands the task the doubt, what was told, the rule's word, the firm's texts and the median, never the range", () => {
    const input = doubtInput({
      firm: "Souza Advogados",
      question: "Quanto eu ganho? Meu CPF é 123.456.789-09",
      facts: { problema: "delay", data: "2099-10-01", acompanhantes: "Pedro, 8 anos" },
      airline: "Azul",
      standing: "ainda em avaliação: faltam respostas sobre o voo",
      fees: "  Os honorários são 30% do que você receber.  ",
      faq: "",
      forecast: forecastOf(FORECAST),
    });
    expect(input.pergunta).not.toContain("123.456.789-09");
    expect(input.o_que_contou).toEqual({
      problema: "atraso",
      companhia: "Azul",
      dia_do_voo: "01/10/2099",
      viajou_com: "Pedro, 8 anos",
    });
    expect(input.honorarios_do_escritorio).toBe("Os honorários são 30% do que você receber.");
    expect(input.duvidas_do_escritorio).toBeNull();
    const forecast = input.previsao as Record<string, unknown>;
    expect(forecast.de_onde).toBe("decisões de primeira instância do TJGO");
    expect(forecast.mediana_do_dano_moral).toMatch(/^R\$\s?3\.000$/);
    expect(forecast.chance_de_ganhar_percent).toBe(76);
    expect(forecast.periodo).toBe("01/03/2099 a 30/09/2099");
    expect(JSON.stringify(input)).not.toMatch(/2\.000|4\.000|p25|p75/);
    expect(doubtInput({ ...baseInput(), forecast: null }).previsao).toBeNull();
  });

  it("says where the case stands by the rule", () => {
    expect(standingWords({ problema: "delay" }, TODAY)).toMatch(/faltam respostas/);
    expect(standingWords({ problema: "delay", data: "2099-10-01", atraso_faixa: "mais_4" }, TODAY)).toBe(
      "pelo que contou, o escritório pode entrar com a ação",
    );
    expect(standingWords({ problema: "delay", data: "2099-10-01", atraso_faixa: "menos_4" }, TODAY)).toBe(
      "pela regra, o caso não tem direito",
    );
  });

  it("keeps the task's answer to the rules of copy, and nothing when it said nothing", () => {
    expect(
      doubtAnswerOf({ resposta: "Não custa nada agora! Fale com a gente — sem custo.", chamar_pessoa: false }),
    ).toEqual({
      text: "Não custa nada agora. Fale com a gente, sem custo.",
      callPerson: false,
    });
    expect(doubtAnswerOf({ resposta: "", chamar_pessoa: false })).toBeNull();
    expect(doubtAnswerOf({ resposta: "", chamar_pessoa: true })).toEqual({ text: "", callPerson: true });
    expect(doubtAnswerOf(null)).toBeNull();
  });

  it("opens ONE's next message with the answer, after the opening of a first one", () => {
    const opening = intakeOpening("Souza Advogados");
    const first = `${opening} O que aconteceu com o voo?`;
    expect(withAnswer("Não custa nada agora.", first, opening)).toBe(
      `${opening}\n\nNão custa nada agora.\n\nO que aconteceu com o voo?`,
    );
    expect(withAnswer("Não custa nada agora.", "Em que dia era o voo?")).toBe(
      "Não custa nada agora.\n\nEm que dia era o voo?",
    );
    expect(withAnswer(null, "Em que dia era o voo?")).toBe("Em que dia era o voo?");
  });

  it("asks the doubt again with a person one choice away, in plain copy", () => {
    const text = doubtAnswered("O valor depende do caso.");
    expect(text).toMatch(/^O valor depende do caso\.\n\nQuer seguir com o seu caso\?\n/);
    expect(text).toContain("Falar com uma pessoa");
    for (const words of [text, DOUBT_ASK]) expect(words).not.toMatch(/[—–!]/);
  });
});

function baseInput() {
  return {
    firm: "Souza Advogados",
    question: "Quanto custa?",
    facts: {},
    airline: null,
    standing: "ainda em avaliação: faltam respostas sobre o voo",
    fees: null,
    faq: null,
    forecast: null,
  };
}
