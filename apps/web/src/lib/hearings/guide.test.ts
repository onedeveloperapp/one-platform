import { describe, expect, it } from "vitest";

import { briefFactsOf } from "@/lib/hearings/brief";
import {
  guideFactLines,
  guideFactsOf,
  guideInput,
  guideReadingLines,
  guideReadingOf,
  momentWords,
} from "@/lib/hearings/guide";

// Every person, flight and number here is invented.

const brief = briefFactsOf([
  {
    hearing_id: "h1",
    org_id: "o1",
    case_id: "c1",
    starts_at: "2099-03-11T13:00:00Z",
    time_zone: "America/Sao_Paulo",
    kind: "conciliacao",
    mode: "videoconferencia",
    case_seq: 7,
    incident: "cancellation",
    airline: "AD",
    claimants: [{ name: "Lia Teste", cents: 1000000 }],
    facts: "O voo foi cancelado no portão.",
    documents: ["identity", "boarding_pass"],
    floor_cents: 300000,
  },
])[0];

const raw = {
  legs: [
    {
      position: 1,
      flight: "AD4221",
      from: "Campinas",
      to: "Brasília",
      scheduled_departure: "2099-10-25T07:00:00",
      scheduled_arrival: "2099-10-25T08:40:00",
      problem_leg: true,
      anac: {
        status: "found",
        record: {
          scheduledArrival: "2099-10-25T08:40",
          actualDeparture: "2099-10-25T13:10",
          actualArrival: "2099-10-25T14:55",
          state: "realizado",
        },
      },
    },
  ],
  weather: [{ airport: "SBKP", at: "2099-10-25T10:00:00+00:00", signs: [], metar: "METAR SBKP 251000Z 12005KT 9999=" }],
  airline_cause: "weather",
  suspension: "file",
  account: "1. O voo foi cancelado no portão.\n2. Ninguém ofereceu hotel.",
  claimants: [{ name: "Pedro Teste", birth_date: "2091-01-01", cents: 500000, guardian: "Lia Teste" }],
  defense_in_case: false,
  piece: "Excelentíssimo...",
  market: {
    unit: { decisions: 40, merits: 30, success_percent: 80, moral: { cancellation: { n: 12, median_cents: 500000 } } },
    court: null,
  },
};

describe("the guide of a hearing for who goes (0246)", () => {
  it("says the trip with ANAC's word and the delay at arrival, the weather and the cause, the account and the court", () => {
    const guide = guideFactsOf(raw)!;
    const text = guideFactLines(brief, guide).join("\n");
    expect(text).toContain(
      "1. AD4221, de Campinas para Brasília (o trecho do problema); previsto 25/10 07:00 a 25/10 08:40; pela ANAC, realizado 25/10 13:10 a 25/10 14:55, chegada 6 h 15 min depois do previsto.",
    );
    expect(text).toContain("A companhia alegou ao passageiro: condições do tempo.");
    expect(text).toContain("sem sinal de mau tempo");
    expect(text).toContain("Tema 1.417 do STJ: o escritório seguiu com a ação.");
    expect(text).toContain("2. Ninguém ofereceu hotel.");
    expect(text).toContain("Pedro Teste, representado por Lia Teste");
    expect(text).toContain("A contestação da companhia ainda não está no caso.");
    expect(text).toContain(
      "A unidade: 40 decisões lidas; o passageiro ganhou em 80% das 30 com mérito; dano moral mediano em cancelamento: R$",
    );
    expect(text).not.toMatch(/[—–!]/);
  });

  it("hands the task the case with the firm's floor, and never a number of its own", () => {
    const input = guideInput(brief, guideFactsOf(raw)!) as { acordo: { piso_do_escritorio: string }; voos: unknown[] };
    expect(input.acordo.piso_do_escritorio).toMatch(/^R\$/);
    expect(input.voos).toHaveLength(1);
  });

  it("reads ONE's answer, cleans it to the copy rules and says it in sections, opening with that ONE may err", () => {
    const reading = guideReadingOf({
      resumo: "Cancelamento no portão, sem assistência!",
      pontos_fortes: [{ ponto: "Atraso de mais de 6 horas", prova: "registro da ANAC" }],
      alegacoes_da_re: [
        { alegacao: "Mau tempo", resposta: "O METAR não mostra mau tempo — céu claro", prova: "METAR" },
      ],
      perguntas_ao_cliente: [{ pergunta: "A companhia ofereceu hotel?", resposta_pelo_caso: "Não, pelo relato." }],
      perguntas_do_advogado: ["Quanto tempo esperou no aeroporto?"],
      pontos_de_atencao: [{ ponto: "Falta comprovante do táxi", como_tratar: "Pergunte ao cliente." }],
      acordo: "O piso do escritório é R$ 3.000,00.",
    })!;
    const text = guideReadingLines(reading).join("\n");
    expect(text).toContain("O ONE pode errar");
    expect(text).toContain("· Mau tempo Resposta: O METAR não mostra mau tempo, céu claro Prova: METAR");
    expect(text).toContain("O QUE PODEM PERGUNTAR AO CLIENTE");
    expect(text).toContain("PARA O ACORDO");
    expect(text).not.toMatch(/[—–!]/);
    expect(guideReadingOf({})).toBeNull();
  });

  it("writes a moment as day and hour", () => {
    expect(momentWords("2099-10-25T02:25")).toBe("25/10 02:25");
    expect(momentWords("2099-10-25 02:25:00")).toBe("25/10 02:25");
    expect(momentWords(null)).toBeNull();
  });
});
