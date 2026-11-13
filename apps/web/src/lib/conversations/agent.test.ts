import { describe, expect, it } from "vitest";

import {
  caseStepsMessage,
  cleanReply,
  declinedMessage,
  fileLine,
  fileRole,
  filesMessage,
  lastClientWords,
  minorsOf,
  modelAnswerOf,
  modelInput,
  paperOf,
  quickAnswer,
  type TurnContext,
  turnContextOf,
  turnFilesOf,
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
    expect(message).toContain("Pronto, Rafael. O escritório abriu o seu caso.");
    expect(message).not.toContain("{caso}");
    expect(message).toContain("1. Abra o seu link: https://one.invalid/c/token");
    // The documents first: the firm reads each person's data in them, and the passenger confirms what was read.
    expect(message).toContain(
      "2. Envie a foto do documento de identidade de cada um (o seu e o de Laura), um comprovante de endereço e o cartão de embarque ou o bilhete.",
    );
    expect(message).toContain("3. Confira os seus dados e os de Laura, que o escritório leu nos documentos");
    expect(message).not.toMatch(/[–—!]/);
    const alone = caseStepsMessage({ passengerName: "Mariana Teste", url: "u", minors: [] });
    expect(alone).toContain("2. Envie a foto do seu documento de identidade, um comprovante de endereço");
    expect(alone).toContain("3. Confira os seus dados, que o escritório leu nos documentos, e complete o que faltar.");
    expect(
      caseStepsMessage({ passengerName: "Rafael Teste", url: "u", minors: ["Laura Teste", "Pedro Teste"] }),
    ).toContain("(o seu, o de Laura e o de Pedro)");
    // A passenger of a partner agency checks what came with the case, and says they finished.
    const agency = caseStepsMessage({
      passengerName: "Mariana Teste",
      url: "u",
      minors: ["Lia Teste"],
      agency: "Viagens Teste",
    });
    expect(agency).toContain("com os dados e os documentos que vieram de Viagens Teste.");
    expect(agency).toContain("2. Confira os seus dados e os de Lia e os documentos que vieram da agência");
    expect(agency).toContain("4. Quando estiver tudo certo, avise no fim da página que terminou");
    expect(agency).not.toContain("Envie");
    expect(agency).not.toMatch(/[–—!]/);
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
  it("reads what paper a file is, and a file the backend could not bring is one it says it did not receive", () => {
    expect(paperOf({ tipo: "boarding_pass", nome: "  RAFAEL   TESTE " })).toEqual({
      kind: "boarding_pass",
      name: "RAFAEL TESTE",
    });
    expect(paperOf({ tipo: "passaporte" })).toEqual({ kind: "other", name: "" });
    expect(paperOf(null)).toEqual({ kind: "other", name: "" });
    const files = turnFilesOf([
      { message_id: "m1", kind: "image", state: "stored", file_id: "f1", storage_path: "org/x/f1", mime: "image/jpeg" },
      { message_id: "m2", kind: "audio", state: "stored", file_id: "f2", storage_path: "org/x/f2", mime: "audio/ogg" },
      { message_id: "m3", kind: "video", state: "stored", file_id: "f3", storage_path: "org/x/f3", mime: "video/mp4" },
      { message_id: "m4", kind: "image", state: "stored", file_id: null },
      { kind: "image" },
    ]);
    expect(files.map(fileRole)).toEqual(["paper", "statement", "not_taken", "failed"]);
  });

  it("says what became of each file, in the firm's rules of copy", () => {
    const message = filesMessage([
      { kind: "paper", paper: "identity", status: "accepted", reason: null },
      {
        kind: "paper",
        paper: "address_proof",
        status: "rejected",
        reason: "A foto ficou cortada! Envie a conta inteira.",
      },
      { kind: "paper", paper: "boarding_pass", status: "waiting", reason: null },
      { kind: "failed" },
    ]);
    expect(message?.split("\n")).toEqual([
      "Recebi o documento de identidade e já juntei ao seu caso. Está tudo certo.",
      "Não deu para aceitar o comprovante de endereço. A foto ficou cortada. Envie a conta inteira.",
      "Recebi o cartão de embarque e juntei ao seu caso. O escritório confere e avisa se precisar de outro.",
      "Não consegui receber um arquivo. Envie de novo, por aqui ou pelo link do seu caso.",
    ]);
    expect(message).not.toMatch(/[–—!]/);
    expect(fileLine({ kind: "no_case" })).toBe("Recebi o arquivo. Ele fica aqui na conversa para o escritório ver.");
    // An identity whose name took the place of the one typed says the name it gave (0236).
    expect(
      fileLine({ kind: "paper", paper: "identity", status: "accepted", reason: null, named: "Nidya Farias de Castro" }),
    ).toBe(
      "Recebi o documento de identidade e já juntei ao seu caso. Vou usar o nome como está nele: Nidya Farias de Castro.",
    );
    expect(filesMessage([])).toBeNull();
    // Two files that failed alike are told once.
    expect(filesMessage([{ kind: "failed" }, { kind: "failed" }])).toBe(
      "Não consegui receber um arquivo. Envie de novo, por aqui ou pelo link do seu caso.",
    );
  });

  it("answers no caption of a file as a question", () => {
    expect(
      lastClientWords([
        { author: "one", kind: "text", text: "Pronto.", at: "1" },
        { author: "cliente", kind: "image", text: "Segue o RG", at: "2" },
        { author: "cliente", kind: "text", text: "Está certo?", at: "3" },
      ]),
    ).toEqual(["Está certo?"]);
  });
});
