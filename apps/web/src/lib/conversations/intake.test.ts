import { describe, expect, it } from "vitest";

import {
  arrivalDelayMinutes,
  choiceOf,
  intakeDoubts,
  intakeFactsOf,
  intakeLead,
  intakeMissing,
  intakeNextAsk,
  intakeOffer,
  intakeOpening,
  intakePersonalMissing,
  intakeQualificationInput,
  intakeQuestion,
  intakeReadingOf,
  intakeSummary,
  leadFollowupText,
  OPTIONS,
  questionText,
} from "@/lib/conversations/intake";
import { qualify } from "@flyee/rules/qualification";

// Every person and flight here is invented.

const TODAY = "2099-10-23";

/** The copy rules of every message to a person: no dash, no exclamation mark. */
const plainCopy = (text: string) => expect(text).not.toMatch(/[—–!]/);

describe("who writes to the firm with no alert", () => {
  it("reads what the task found, leaving out what is no fact and a masked identifier", () => {
    expect(
      intakeReadingOf({
        assunto: "problema_voo",
        problema: "delay",
        companhia: "LA",
        voo: "LA 3456",
        data: "2099-10-22",
        origem: "",
        destino: "",
        atraso_horas: "6",
        aviso: "",
        nome: "[nome 1]",
        acompanhantes: "nenhum",
        etapa: "oferta",
      }),
    ).toEqual({
      flight: true,
      facts: {
        problema: "delay",
        companhia: "LA",
        voo: "LA 3456",
        data: "2099-10-22",
        atraso_horas: "6",
        acompanhantes: "nenhum",
      },
      question: null,
    });
    expect(intakeReadingOf({ assunto: "outro" })).toEqual({ flight: false, facts: {}, question: null });
    // The doubt asked is read apart, never as a fact (0249).
    expect(
      intakeReadingOf({ assunto: "problema_voo", problema: "delay", pergunta: " Quanto eu posso ganhar? " }),
    ).toEqual({ flight: true, facts: { problema: "delay" }, question: "Quanto eu posso ganhar?" });
    expect(intakeReadingOf({ assunto: "talvez" })).toBeNull();
    expect(intakeReadingOf(null)).toBeNull();
  });

  it("keeps where ONE stands only when it is a step it knows", () => {
    expect(intakeFactsOf({ nome: "Lia", etapa: "resumo" })).toEqual({ nome: "Lia", etapa: "resumo" });
    expect(intakeFactsOf({ nome: "Lia", etapa: "inventada" })).toEqual({ nome: "Lia" });
  });

  it("asks first what decides the right, never the airline nor the flight, and the person only after the yes (0239)", () => {
    expect(intakeMissing({})).toEqual(["problema", "data"]);
    expect(intakeMissing({ problema: "delay", data: "2099-10-22" })).toEqual(["chegada"]);
    expect(intakeMissing({ problema: "cancellation", data: "2099-10-22" })).toEqual(["aviso", "chegada"]);
    // One question with its options, whatever of the times was told (0242).
    expect(intakeMissing({ problema: "delay", data: "2099-10-22", chegada_prevista: "14:00" })).toEqual(["chegada"]);
    expect(intakeMissing({ problema: "delay", data: "2099-10-22", atraso_faixa: "mais_4" })).toEqual([]);
    // Who did not travel after a cancellation is decided by the notice alone.
    expect(intakeMissing({ problema: "cancellation", data: "2099-10-22", aviso: "late", viajou: "nao" })).toEqual([]);
    expect(intakeMissing({ problema: "overbooking", data: "2099-10-22" })).toEqual([]);
    // Nothing of the person is asked before the "Quero seguir".
    expect(intakeNextAsk({ problema: "overbooking", data: "2099-10-22", etapa: "oferta" })).toBeNull();
    expect(intakePersonalMissing({})).toEqual(["nome", "acompanhantes"]);
    expect(intakeNextAsk({ etapa: "seguir", nome: "Lia" })).toBe("acompanhantes");
    expect(intakeNextAsk({ etapa: "seguir", nome: "Lia", acompanhantes: "mais" })).toBe("nomes");
  });

  it("counts how late the passenger arrived from the two times, past midnight on the next day (0239)", () => {
    const day = { data: "2099-10-22" };
    expect(arrivalDelayMinutes({ ...day, chegada_prevista: "14:00", chegada_real: "20:30" })).toBe(390);
    expect(arrivalDelayMinutes({ ...day, chegada_prevista: "22:00", chegada_real: "01:30" })).toBe(210);
    expect(
      arrivalDelayMinutes({ ...day, chegada_prevista: "2099-10-22T22:00", chegada_real: "2099-10-23T09:00" }),
    ).toBe(660);
    expect(arrivalDelayMinutes({ ...day, atraso_horas: "4,5" })).toBe(270);
    expect(arrivalDelayMinutes({ ...day, chegada_prevista: "14:00" })).toBeNull();
    expect(arrivalDelayMinutes({ chegada_prevista: "14:00", chegada_real: "20:00" })).toBeNull();
  });

  it("opens by saying who speaks, and thanks or cares once for what the reply brought", () => {
    const first = intakeQuestion({ ask: "problema", first: true, firm: "Souza Advogados", before: {}, after: {} });
    expect(first.split("\n")[0]).toBe(
      "Oi, aqui é o assistente virtual do escritório Souza Advogados. Vou te ajudar a ver se o escritório pode cuidar do seu caso. São poucas perguntas, uns 2 minutos. O que aconteceu com o voo?",
    );
    expect(
      intakeQuestion({
        ask: "chegada",
        first: false,
        firm: "Souza Advogados",
        before: { problema: "cancellation", data: "2099-10-22" },
        after: { problema: "cancellation", data: "2099-10-22", aviso: "late" },
      }),
    ).toBe(
      "O cancelamento gerou quanto tempo de atraso até você chegar ao destino final?\n1. Menos de quatro horas\n2. Mais de quatro horas\n3. Não cheguei a viajar",
    );
    expect(questionText("chegada", { problema: "delay" })).not.toContain("Não cheguei a viajar");
    expect(intakeOpening("")).toContain("assistente virtual do escritório.");
    expect(intakeLead({ problema: "cancellation" }, { problema: "cancellation", nome: "Nídia" })).toBe(
      "Obrigado, Nídia.",
    );
    expect(intakeLead({}, { problema: "cancellation", nome: "Nídia Teste" })).toBe(
      "Sinto muito pelo cancelamento, Nídia.",
    );
    expect(intakeLead({ nome: "Lia" }, { nome: "Lia", problema: "delay" })).toBe("Sinto muito pelo atraso.");
    expect(intakeLead({ nome: "Lia" }, { nome: "Lia" })).toBeNull();
    const asked = intakeQuestion({
      ask: "aviso",
      first: false,
      firm: "Souza Advogados",
      before: { nome: "Lia" },
      after: { nome: "Lia", problema: "cancellation" },
    });
    expect(asked).toBe(
      "Sinto muito pelo cancelamento. Quando a companhia avisou do cancelamento?\n1. No aeroporto\n2. Menos de 72 horas antes\n3. Com mais antecedência",
    );
    for (const ask of [
      "nome",
      "problema",
      "data",
      "aviso",
      "chegada",
      "chegada_prevista",
      "chegada_real",
      "acompanhantes",
      "nomes",
    ] as const) {
      plainCopy(questionText(ask, { problema: "change" }));
    }
    // Every option fits a row of the vendor's list, so the official API shows them as buttons or a list.
    for (const options of Object.values(OPTIONS)) {
      for (const option of options) expect(option.label.length).toBeLessThanOrEqual(24);
    }
  });

  it("takes a choice by its number, its label or its word, and leaves anything else to the task", () => {
    expect(choiceOf(OPTIONS.problema, "1")).toBe("cancellation");
    expect(choiceOf(OPTIONS.problema, "2.")).toBe("delay");
    expect(choiceOf(OPTIONS.problema, "9")).toBeNull();
    expect(choiceOf(OPTIONS.problema, "Perdi a conexão")).toBe("missed_connection");
    expect(choiceOf(OPTIONS.problema, "cancelou")).toBe("cancellation");
    expect(choiceOf(OPTIONS.aviso, "umas 10 horas antes")).toBeNull();
    expect(choiceOf(OPTIONS.aviso, "no aeroporto")).toBe("at_airport");
    expect(choiceOf(OPTIONS.acompanhantes, "Só eu")).toBe("nenhum");
    expect(choiceOf(OPTIONS.acompanhantes, "não")).toBe("nenhum");
    expect(choiceOf(OPTIONS.resumo, "sim")).toBe("certo");
    expect(choiceOf(OPTIONS.resumo, "o voo foi dia 26")).toBeNull();
    expect(choiceOf(OPTIONS.oferta, "Quero seguir")).toBe("seguir");
    expect(choiceOf(OPTIONS.oferta, "agora não")).toBe("agora_nao");
    expect(choiceOf(OPTIONS.oferta, "quanto vou pagar?")).toBeNull();
    expect(choiceOf(OPTIONS.duvidas, "2")).toBe("pessoa");
    expect(choiceOf(OPTIONS.chegada, "1")).toBe("menos_4");
    expect(choiceOf(OPTIONS.chegada, "Mais de quatro horas")).toBe("mais_4");
    expect(choiceOf(OPTIONS.chegada, "3")).toBe("nao");
    expect(choiceOf(OPTIONS.chegada, "não viajei")).toBe("nao");
    expect(choiceOf(OPTIONS.chegada, "cheguei as 22h")).toBeNull();
    // The band chosen is the rule's: more than four hours is its 4 hours, less is short of them.
    expect(arrivalDelayMinutes({ data: "2099-10-22", atraso_faixa: "mais_4" })).toBe(240);
    expect(
      qualify(
        intakeQualificationInput(
          { problema: "cancellation", data: "2099-10-22", aviso: "late", atraso_faixa: "menos_4" },
          "2099-10-23",
        ),
      ).outcome,
    ).toBe("not_qualified");
  });

  it("sums up what decides the right, with the year, for the person to confirm", () => {
    const summary = intakeSummary(
      {
        problema: "cancellation",
        companhia: "AD",
        data: "2099-10-25",
        origem: "VCP",
        destino: "BSB",
        aviso: "late",
        chegada_prevista: "10:00",
        chegada_real: "16:00",
      },
      { airline: "Azul", origin: "Campinas", destination: "Brasília" },
    );
    expect(summary).toBe(
      "Confere o que eu entendi. Voo da Azul, de Campinas para Brasília, em 25/10/2099: cancelado, com aviso menos de 72 horas antes e você chegou ao destino final 6 horas depois do previsto. Está certo?\n1. Está certo\n2. Corrigir",
    );
    const late = intakeSummary(
      { problema: "delay", data: "2099-10-22", atraso_horas: "4.5" },
      { airline: null, origin: null, destination: null },
    );
    expect(late).toContain(
      "O seu voo de 22/10/2099: atrasou e você chegou ao destino final 4 horas e 30 minutos depois do previsto.",
    );
    const stayed = intakeSummary(
      { problema: "cancellation", data: "2099-10-22", aviso: "at_airport", viajou: "nao" },
      { airline: null, origin: null, destination: null },
    );
    expect(stayed).toContain("cancelado, com aviso só no aeroporto e você não chegou a viajar.");
    plainCopy(summary);
    plainCopy(late);
  });

  it("offers to go on with the firm's own words on its fees, and its answers to doubts", () => {
    expect(intakeOffer({ airline: "Azul", fees: "Você não paga nada agora." })).toBe(
      "Pelo que você contou, o escritório pode entrar com uma ação contra a Azul por você. Você não paga nada agora. Quer que o escritório siga com o seu caso?\n1. Quero seguir\n2. Tenho dúvidas\n3. Agora não",
    );
    expect(intakeOffer({ airline: null, fees: null })).toContain("contra a companhia aérea por você. Quer que");
    const doubts = intakeDoubts("Quanto custa: nada agora.");
    expect(doubts).toBe(
      "Quanto custa: nada agora.\n\nQuer seguir com o seu caso?\n1. Quero seguir\n2. Falar com uma pessoa\n3. Agora não",
    );
    plainCopy(intakeOffer({ airline: "Gol", fees: null }));
  });

  it("hands the rule of qualification what it reads", () => {
    const late = intakeQualificationInput(
      { problema: "delay", voo: "LA3456", data: "2099-10-22", atraso_horas: "6", nome: "Lucas Teste" },
      TODAY,
    );
    expect(late).toMatchObject({ problem: "delay", flightDay: "2099-10-22", arrivalDelayMinutes: 360 });
    expect(qualify(late).outcome).toBe("qualifies");
    const short = intakeQualificationInput({ problema: "delay", data: "2099-10-22", atraso_horas: "2" }, TODAY);
    expect(qualify(short).outcome).toBe("not_qualified");
    const told = intakeQualificationInput({ problema: "cancellation", data: "2099-10-22", aviso: "early" }, TODAY);
    expect(told.notice).toBe("early");
    // v2: the arrival decides a cancellation the passenger travelled after, and the notice one they did not.
    const close = intakeQualificationInput(
      { problema: "cancellation", data: "2099-10-22", aviso: "late", chegada_prevista: "10:00", chegada_real: "12:00" },
      TODAY,
    );
    expect(qualify(close).outcome).toBe("not_qualified");
    const stayed = intakeQualificationInput(
      { problema: "cancellation", data: "2099-10-22", aviso: "late", viajou: "nao" },
      TODAY,
    );
    expect(qualify(stayed).outcome).toBe("qualifies");
    expect(qualify(intakeQualificationInput({ problema: "delay", data: "2093-10-22" }, TODAY)).outcome).toBe(
      "not_qualified",
    );
  });
});

describe("the follow-up of a lead who stopped answering (0207)", () => {
  it("asks again what is still missing, the second time saying how to stop", () => {
    const first = leadFollowupText({ problema: "cancellation" }, 0);
    expect(first).toBe("Oi, ainda posso te ajudar com o que aconteceu no seu voo. Em que dia era o voo?");
    const second = leadFollowupText({ problema: "cancellation", data: "2099-10-22", aviso: "late" }, 1);
    expect(second).toContain("responda SAIR");
    expect(second).toContain("O cancelamento gerou quanto tempo de atraso até você chegar ao destino final?");
    // After the "Quero seguir", what is missing of the person.
    expect(leadFollowupText({ problema: "overbooking", data: "2099-10-22", etapa: "seguir" }, 0)).toContain(
      "Como posso te chamar?",
    );
    for (const text of [first, second]) plainCopy(String(text));
  });

  it("says nothing when the intake lacks nothing", () => {
    expect(
      leadFollowupText(
        {
          problema: "cancellation",
          data: "2099-10-22",
          aviso: "late",
          chegada_prevista: "10:00",
          chegada_real: "18:00",
        },
        0,
      ),
    ).toBeNull();
  });
});

describe("who travelled along (0234)", () => {
  it("reads each name and age the intake kept, and tells a child from an adult", async () => {
    const { companionsOf, isChild } = await import("@/lib/conversations/intake");
    expect(companionsOf("Pedro, 8 anos; Ana")).toEqual([
      { name: "Pedro", age: 8 },
      { name: "Ana", age: null },
    ]);
    expect(companionsOf("Bia Teste de 12 anos e Caio Teste")).toEqual([
      { name: "Bia Teste", age: 12 },
      { name: "Caio Teste", age: null },
    ]);
    expect(companionsOf("nenhum")).toEqual([]);
    expect(companionsOf("mais")).toEqual([]);
    expect(companionsOf("Pedro, 8 anos; Ana").map(isChild)).toEqual([true, false]);
    expect(isChild({ name: "Lia", age: 19 })).toBe(false);
  });
});

describe("the case an intake opened (0234)", () => {
  it("asks the identity alone, with no link, the child's paper later and the adult to write themself (0236)", async () => {
    const { intakeOpenedMessage } = await import("@/lib/conversations/agent");
    expect(
      intakeOpenedMessage({ passengerName: "Nídia Teste", firm: "Souza Advogados", children: [], adults: [] }),
    ).toBe(
      [
        "Pronto, Nídia. O seu caso está aberto no escritório Souza Advogados.",
        "Agora mande aqui a foto do seu documento de identidade, RG ou CNH, com a frente e o verso.",
      ].join("\n"),
    );
    const message = intakeOpenedMessage({
      passengerName: "Nídia Teste",
      firm: "Souza Advogados",
      children: ["Pedro Teste"],
      adults: ["Ana Teste"],
    });
    expect(message).toContain("Depois vou pedir o documento de Pedro.");
    expect(message).toContain(
      "Ana também viajou: peça que escreva para este número, porque cada adulto tem o próprio caso.",
    );
    expect(message).not.toMatch(/https?:|[—–!]/);
  });
});
