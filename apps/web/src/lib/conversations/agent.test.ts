import { describe, expect, it } from "vitest";

import {
  caseStepsMessage,
  cleanReply,
  declinedMessage,
  lastClientWords,
  minorsOf,
  modelAnswerOf,
  modelInput,
  quickAnswer,
  type TurnContext,
  turnContextOf,
} from "@/lib/conversations/agent";

// Every person, firm and number here is invented.

const CONTEXT: TurnContext = {
  orgId: "b5500000-0000-4000-8000-00000000000a",
  firm: "Souza Advogados",
  contactName: "Rafael",
  through: "2099-10-22T14:00:00Z",
  test: true,
  answersLastHour: 0,
  modes: { replyClient: "auto", openCaseFromChat: "auto", sendClientLink: "auto" },
  alert: {
    alertId: "f5500000-0000-4000-8000-000000000001",
    kind: "delayed",
    delayMinutes: 360,
    passengerName: "Rafael Teste",
    companions: [
      { name: "Laura Teste", birthDate: "2091-06-01" },
      { name: "Bruna Teste", birthDate: "2060-01-01" },
    ],
  },
  cases: [],
  messages: [
    { author: "one", kind: "template", text: "Olá, Rafael.", at: "2099-10-22T13:00:00Z" },
    { author: "cliente", kind: "text", text: "Meu CPF é 123.456.789-09", at: "2099-10-22T13:59:00Z" },
    { author: "cliente", kind: "text", text: "e o meu e-mail é rafael@teste.invalid", at: "2099-10-22T14:00:00Z" },
  ],
};

describe("ONE in a conversation", () => {
  it("reads the plain answers to its first word, however they are typed, and leaves the rest to the model", () => {
    expect(quickAnswer("SIM")).toBe("yes");
    expect(quickAnswer("  sim, quero ")).toBe("yes");
    expect(quickAnswer("NÃO")).toBe("no");
    expect(quickAnswer("nao.")).toBe("no");
    expect(quickAnswer("SAIR")).toBe("stop");
    expect(quickAnswer("Parar")).toBe("stop");
    expect(quickAnswer("sim, mas quanto tempo demora?")).toBeNull();
    expect(quickAnswer("")).toBeNull();
  });

  it("writes the next steps after a yes, with the children by name and the case's number for the database", () => {
    const message = caseStepsMessage({
      passengerName: "Rafael Teste",
      url: "https://one.invalid/c/token",
      minors: ["Laura Teste"],
    });
    expect(message).toContain("Pronto, Rafael. O escritório abriu o seu caso, número {caso}.");
    expect(message).toContain("1. Abra o seu link: https://one.invalid/c/token");
    expect(message).toContain("2. Preencha os seus dados e os de Laura.");
    expect(message).not.toMatch(/[–—!]/);
    expect(caseStepsMessage({ passengerName: "Mariana Teste", url: "u", minors: [] })).toContain(
      "2. Preencha os seus dados.",
    );
    expect(declinedMessage("Pedro Teste")).toBe(
      "Tudo bem, Pedro. O escritório não vai seguir com este caso. Se mudar de ideia, é só escrever aqui.",
    );
  });

  it("reads what the model answered, and cleans its words to the firm's rules", () => {
    expect(modelAnswerOf({ intencao: "pergunta", resposta: "Oi.", chamar_pessoa: null })).toEqual({
      intent: "pergunta",
      reply: "Oi.",
      callPerson: null,
    });
    expect(modelAnswerOf({ intencao: "outra coisa" })).toBeNull();
    expect(cleanReply("Claro! O escritório — que cuida do caso — responde já 😊")).toBe(
      "Claro. O escritório, que cuida do caso, responde já",
    );
    expect(cleanReply("   ")).toBeNull();
    expect(cleanReply("a".repeat(800))?.length).toBe(700);
  });

  it("reads the turn the database hands over, and the children who travel", () => {
    const read = turnContextOf({
      ok: true,
      org_id: CONTEXT.orgId,
      firm: "Souza Advogados",
      through: "2099-10-22T14:00:00Z",
      modes: { reply_client: "approval" },
      alert: { alert_id: "x", kind: "cancelled", passenger_name: "Mariana Teste", companions: [] },
      messages: [
        { author: "cliente", kind: "button", text: "SIM", at: "2099" },
        { author: "robo", text: "?" },
      ],
    });
    expect(read?.modes.replyClient).toBe("approval");
    expect(read?.messages).toHaveLength(1);
    expect(turnContextOf({ ok: false })).toBeNull();
    expect(minorsOf(CONTEXT, "2099-10-22")).toEqual(["Laura Teste"]);
    expect(lastClientWords(CONTEXT.messages)).toEqual([
      "Meu CPF é 123.456.789-09",
      "e o meu e-mail é rafael@teste.invalid",
    ]);
  });

  it("hands the model the conversation with every identifier taken out", () => {
    const input = modelInput(CONTEXT) as {
      passageiro: string;
      mensagens: { texto: string }[];
      aviso: { viaja_com: string[] };
    };
    expect(input.passageiro).toBe("Rafael");
    expect(input.aviso.viaja_com).toEqual(["Laura", "Bruna"]);
    expect(input.mensagens[1].texto).toBe("Meu CPF é [CPF]");
    expect(input.mensagens[2].texto).toBe("e o meu e-mail é [e-mail]");
  });
});
