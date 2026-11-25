import { describe, expect, it } from "vitest";

import {
  caseFactsOf,
  costReadingOf,
  documentReadingOf,
  flightOf,
  legComplete,
  PREFILL_READINGS,
  PREFILL_TASK,
  prefillBriefing,
  prefillErrorKey,
  receiptReadingOf,
} from "@/lib/cases/document-prefill";
import messages from "@flyee/content/messages/pt-BR.json";
import { cnjCheckDigits } from "@flyee/rules/cnj";

const product = messages.product as Record<string, string>;
const TODAY = "2026-11-03";

const identity = {
  confere_tipo: "sim",
  tipo_identificado: "RG",
  legivel: true,
  nome_no_documento: "MARIANA TESTE DE OLIVEIRA",
  dados_lidos: {
    nome_completo: "Mariana Teste de Oliveira",
    cpf: "529.982.247-25",
    data_nascimento: "1988-03-02",
    nacionalidade: "Brasileira",
    cep: "",
    logradouro: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
  },
  trechos: [],
  observacoes: "",
};

describe("what ONE read of a document, for a form", () => {
  it("takes a person from an identity, each field marked as read", () => {
    const reading = documentReadingOf(identity, TODAY);
    expect(reading.matches).toBe(true);
    expect(reading.person.values).toEqual({
      full_name: "Mariana Teste de Oliveira",
      cpf: "52998224725",
      birth_date: "1988-03-02",
      nationality: "brasileira",
    });
    expect(reading.person.read).toEqual(["full_name", "cpf", "birth_date", "nationality"]);
    expect(reading.legs).toEqual([]);
  });

  it("leaves out what does not pass the form's checks", () => {
    const reading = documentReadingOf(
      {
        ...identity,
        dados_lidos: {
          ...identity.dados_lidos,
          nome_completo: "M.",
          cpf: "111.111.111-12",
          data_nascimento: "2031-01-01",
        },
      },
      TODAY,
    );
    expect(reading.person.values).toEqual({ nationality: "brasileira" });
    // A day of issue read as the birth date is no birth date when it is still to come.
    expect(documentReadingOf({ dados_lidos: { data_nascimento: "1988-02-30" } }, TODAY).person.values).toEqual({});
  });

  it("takes an address only whole enough to be one", () => {
    const address = {
      cep: "74000-000",
      logradouro: "Rua das Flores",
      numero: "10",
      complemento: "",
      bairro: "Centro",
      cidade: "Goiânia",
      uf: "go",
    };
    expect(documentReadingOf({ dados_lidos: address }, TODAY).person.values).toEqual({
      postal_code: "74000000",
      street: "Rua das Flores",
      address_number: "10",
      district: "Centro",
      city: "Goiânia",
      uf: "GO",
    });
    expect(documentReadingOf({ dados_lidos: { ...address, uf: "XX" } }, TODAY).person.values).toEqual({});
  });

  it("takes the legs of a ticket, a screenshot of a booking included, in the order they fly", () => {
    const reading = documentReadingOf(
      {
        confere_tipo: "sim",
        legivel: true,
        tipo_identificado: "print da reserva",
        trechos: [
          {
            voo: "LA 3457",
            origem: "gig",
            destino: "GRU",
            saida_prevista: "2099-05-12 18:00",
            chegada_prevista: "2099-05-12T19:05",
            reserva: "tstm4r",
          },
          {
            voo: "LA-03456",
            origem: "GRU",
            destino: "GIG",
            saida_prevista: "2099-05-10T08:10",
            chegada_prevista: "2099-05-10T09:15",
            reserva: "TSTM4R",
          },
          { voo: "", origem: "", destino: "", saida_prevista: "", chegada_prevista: "", reserva: "" },
        ],
      },
      TODAY,
    );
    expect(reading.legs.map((leg) => leg.flight_number)).toEqual(["LA3456", "LA3457"]);
    expect(reading.legs[1]).toEqual({
      flight_number: "LA3457",
      booking_reference: "TSTM4R",
      origin_iata: "GIG",
      destination_iata: "GRU",
      scheduled_departure_local: "2099-05-12T18:00",
      scheduled_arrival_local: "2099-05-12T19:05",
    });
    expect(reading.legs.every(legComplete)).toBe(true);
    expect(legComplete({ ...reading.legs[0], origin_iata: "" })).toBe(false);
  });

  it("writes a flight as the platform does", () => {
    expect(flightOf("g3 1234")).toBe("G31234");
    expect(flightOf("AD-04050")).toBe("AD4050");
    expect(flightOf("voo")).toBe("");
  });

  it("gives a new case the airline of its first flight and its day, when the airline is known", () => {
    const reading = documentReadingOf(
      {
        trechos: [
          {
            voo: "G3 1234",
            origem: "GYN",
            destino: "BSB",
            saida_prevista: "2099-01-20T07:00",
            chegada_prevista: "2099-01-20T08:00",
          },
        ],
      },
      TODAY,
    );
    expect(caseFactsOf(reading, [{ iata: "G3" }, { iata: "LA" }], TODAY)).toEqual({
      airline: "G3",
      flightDate: "2099-01-20",
      choices: [],
    });
    expect(caseFactsOf(reading, [{ iata: "LA" }], TODAY)).toEqual({
      airline: "",
      flightDate: "2099-01-20",
      choices: [],
    });
    expect(caseFactsOf(null, [], TODAY)).toEqual({ airline: "", flightDate: "", choices: [] });
  });

  // 0293: Azul's boarding pass, a screenshot of its app, prints "22 de out." and never the year.
  it("asks which year a day printed without its year is of, among the last two, never supposing it", () => {
    const reading = documentReadingOf(
      { trechos: [{ voo: "AD 4530", origem: "VCP", destino: "JTC", saida_prevista: "", dia_mes_saida: "22/10" }] },
      "2026-11-25",
    );
    expect(reading.legs[0].departure_day).toBe("10-22");
    const facts = caseFactsOf(reading, [{ iata: "AD" }], "2026-11-25");
    expect(facts.flightDate).toBe("");
    expect(facts.airline).toBe("AD");
    expect(facts.choices.map((choice) => [choice.date, choice.yearRead])).toEqual([
      ["2026-10-22", false],
      ["2025-10-22", false],
    ]);
    // A day no month has is no day.
    const wrong = documentReadingOf({ trechos: [{ voo: "AD 4530", dia_mes_saida: "31/02" }] }, "2026-11-25");
    expect(wrong.legs[0].departure_day).toBeUndefined();
    expect(caseFactsOf(wrong, [], "2026-11-25").choices).toEqual([]);
  });

  it("asks which flight had the problem when the ticket's flights are on different days", () => {
    const reading = documentReadingOf(
      {
        trechos: [
          { voo: "G3 1234", origem: "GYN", destino: "GRU", saida_prevista: "2099-01-20T07:00" },
          { voo: "G3 1240", origem: "GRU", destino: "GYN", saida_prevista: "2099-01-27T18:00" },
        ],
      },
      TODAY,
    );
    const facts = caseFactsOf(reading, [{ iata: "G3" }], TODAY);
    expect(facts.flightDate).toBe("");
    expect(facts.airline).toBe("G3");
    expect(
      facts.choices.map((choice) => `${choice.date} ${choice.flight} ${choice.origin}-${choice.destination}`),
    ).toEqual(["2099-01-20 G31234 GYN-GRU", "2099-01-27 G31240 GRU-GYN"]);
  });

  it("reads a filing's receipt: the number only when its check digits hold, and a day that has come", () => {
    // A number of a year to come, with its check digits: no real lawsuit carries it.
    const number = `0000001-${cnjCheckDigits("000000120998090051")}.2099.8.09.0051`;
    const read = receiptReadingOf(
      {
        confere_tipo: "sim",
        legivel: true,
        numero_processo: number,
        data_protocolo: "2026-11-02",
        tribunal: "tjgo",
        sistema: "Projudi",
        orgao: "1º Juizado Especial Cível",
        classe: "Procedimento do Juizado Especial Cível",
        observacoes: "",
      },
      TODAY,
    );
    expect(read.court).toBe("TJGO");
    expect(read.filedOn).toBe("2026-11-02");
    expect(read.cnj).toBe(number);
    expect(read.cnjRead).toBe("");
    const wrong = receiptReadingOf(
      { numero_processo: "1234567-00.2099.8.09.0051", data_protocolo: "2026-12-01" },
      TODAY,
    );
    expect(wrong.cnj).toBe("");
    expect(wrong.cnjRead).toBe("1234567-00.2099.8.09.0051");
    expect(wrong.filedOn).toBe("");
  });
});

describe("the readings and their words", () => {
  it("has a task and a briefing for every reading", () => {
    for (const reading of PREFILL_READINGS) {
      expect(PREFILL_TASK[reading]).toMatch(/^caso\./);
      expect(prefillBriefing(reading)).toContain("Tipo de documento que foi dito");
    }
  });

  it("has words for every refusal it names, and a general one", () => {
    for (const code of [
      "prefill_limit",
      "not_allowed_in_support_session",
      "provider_not_configured",
      "type_not_allowed",
      "too_large",
      "x",
    ]) {
      expect(product[prefillErrorKey(code)], code).toBeTruthy();
    }
  });
});

describe("what ONE read of a cost's receipt", () => {
  it("keeps the value, the day and what was paid", () => {
    expect(
      costReadingOf(
        {
          tipo: "guia_custas",
          legivel: true,
          descricao: "  Custas   iniciais ",
          valor_centavos: 18_734,
          data: "2026-11-03",
          observacoes: "",
        },
        "2026-11-10",
      ),
    ).toEqual({
      isCost: true,
      legible: true,
      description: "Custas iniciais",
      cents: 18_734,
      spentOn: "2026-11-03",
      note: "",
    });
  });

  it("leaves out a day still to come, a value that is none, and says a paper that is no expense", () => {
    const read = costReadingOf(
      {
        tipo: "outro",
        legivel: true,
        descricao: "x",
        valor_centavos: -5,
        data: "2026-12-01",
        observacoes: "Uma procuração.",
      },
      "2026-11-10",
    );
    expect(read).toEqual({
      isCost: false,
      legible: true,
      description: "",
      cents: 0,
      spentOn: "",
      note: "Uma procuração.",
    });
  });
});
