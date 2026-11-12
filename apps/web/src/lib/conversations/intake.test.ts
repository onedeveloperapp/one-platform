import { describe, expect, it } from "vitest";

import {
  choiceOf,
  intakeDoubts,
  intakeFactsOf,
  intakeLead,
  intakeMissing,
  intakeOffer,
  intakeOpening,
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
    });
    expect(intakeReadingOf({ assunto: "outro" })).toEqual({ flight: false, facts: {} });
    expect(intakeReadingOf({ assunto: "talvez" })).toBeNull();
    expect(intakeReadingOf(null)).toBeNull();
  });

  it("keeps where ONE stands only when it is a step it knows", () => {
    expect(intakeFactsOf({ nome: "Lia", etapa: "resumo" })).toEqual({ nome: "Lia", etapa: "resumo" });
    expect(intakeFactsOf({ nome: "Lia", etapa: "inventada" })).toEqual({ nome: "Lia" });
  });

  it("asks the name first, then the trip, then who travelled along", () => {
    expect(intakeMissing({})).toEqual(["nome", "problema", "voo", "data", "acompanhantes"]);
    expect(intakeMissing({ nome: "Lucas", problema: "delay", voo: "LA3456", data: "2099-10-22" })).toEqual([
      "atraso",
      "acompanhantes",
    ]);
    expect(
      intakeMissing({ nome: "Lia", problema: "cancellation", origem: "VCP", destino: "BSB", data: "2099-10-22" }),
    ).toEqual(["aviso", "acompanhantes"]);
    expect(
      intakeMissing({ nome: "Lia", problema: "overbooking", voo: "G31450", data: "2099-10-22", acompanhantes: "mais" }),
    ).toEqual(["nomes"]);
    expect(
      intakeMissing({
        nome: "Lia",
        problema: "overbooking",
        voo: "G31450",
        data: "2099-10-22",
        acompanhantes: "nenhum",
      }),
    ).toEqual([]);
  });

  it("opens by saying who speaks, and thanks or cares once for what the reply brought", () => {
    const first = intakeQuestion({ ask: "nome", first: true, firm: "Souza Advogados", before: {}, after: {} });
    expect(first).toBe(
      "Oi, aqui é o assistente virtual do escritório Souza Advogados. Vou te ajudar a ver se o escritório pode cuidar do seu caso. São poucas perguntas, uns 2 minutos. Como posso te chamar?",
    );
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
      "Sinto muito pelo cancelamento. Quando a companhia avisou do cancelamento?\n1. No aeroporto\n2. Menos de 72 horas antes do voo\n3. Com mais antecedência",
    );
    for (const ask of ["nome", "problema", "voo", "data", "atraso", "aviso", "acompanhantes", "nomes"] as const) {
      plainCopy(questionText(ask, { problema: "change" }));
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
  });

  it("sums up what it understood, with the year, for the person to confirm", () => {
    const summary = intakeSummary(
      {
        nome: "Nídia Teste",
        problema: "cancellation",
        companhia: "AD",
        data: "2099-10-25",
        origem: "VCP",
        destino: "BSB",
        aviso: "late",
        acompanhantes: "nenhum",
      },
      { airline: "Azul", origin: "Campinas", destination: "Brasília" },
    );
    expect(summary).toBe(
      "Confere, Nídia. Voo da Azul, de Campinas para Brasília, em 25/10/2099: cancelado, com aviso menos de 72 horas antes. Só você viajou. Está certo?\n1. Está certo\n2. Corrigir",
    );
    const late = intakeSummary(
      {
        nome: "Lucas",
        problema: "delay",
        voo: "la 3456",
        data: "2099-10-22",
        atraso_horas: "4.5",
        acompanhantes: "Pedro, 8 anos;",
      },
      { airline: null, origin: null, destination: null },
    );
    expect(late).toContain("Voo LA 3456, em 22/10/2099: atrasou, com 4,5 horas de atraso na chegada.");
    expect(late).toContain("Viajou com você: Pedro, 8 anos.");
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
  });
});

describe("the follow-up of a lead who stopped answering (0207)", () => {
  it("asks again what is still missing, the second time saying how to stop", () => {
    const first = leadFollowupText({ nome: "Lia", problema: "cancellation" }, 0);
    expect(first).toBe(
      "Oi, ainda posso te ajudar com o que aconteceu no seu voo. Qual era a companhia aérea e o número do voo? Se não souber o número, diga de qual cidade para qual cidade era.",
    );
    const second = leadFollowupText({ nome: "Lia", problema: "cancellation", voo: "AD 4040" }, 1);
    expect(second).toContain("responda SAIR");
    expect(second).toContain("Em que dia era o voo?");
    for (const text of [first, second]) plainCopy(String(text));
  });

  it("says nothing when the intake lacks nothing", () => {
    expect(
      leadFollowupText(
        {
          problema: "cancellation",
          voo: "AD 4040",
          data: "2099-10-22",
          aviso: "late",
          nome: "Maria Teste",
          acompanhantes: "nenhum",
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
  it("asks the child's paper later and the adult to write themself", async () => {
    const { intakeOpenedMessage } = await import("@/lib/conversations/agent");
    const message = intakeOpenedMessage({
      passengerName: "Nídia Teste",
      firm: "Souza Advogados",
      url: "https://one.invalid/c/x",
      children: ["Pedro Teste"],
      adults: ["Ana Teste"],
    });
    expect(message).toContain("Pronto, Nídia. O seu caso está aberto no escritório Souza Advogados.");
    expect(message).toContain("a certidão de nascimento ou o RG de Pedro, que entra no seu caso com você.");
    expect(message).toContain("Para Ana, que também viajou: peça que escreva para este número.");
    expect(message).not.toMatch(/[—–!]/);
  });
});
