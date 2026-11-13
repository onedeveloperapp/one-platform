import { describe, expect, it } from "vitest";

import { factsAskedMessage, factsReminderMessage } from "@/lib/cases/piece-facts";
import {
  chatQuestionOf,
  chatQuestionText,
  FACTS_LINE,
  factsChoice,
  freeJusticeExplained,
  questionAnswered,
  questionChoice,
  RESIDENCE_ANSWERED,
  residenceAsk,
  residenceChoice,
  residenceNoteAsk,
  residenceNoteOf,
} from "@/lib/conversations/questions";

// Every person here is invented.

describe("what the client is asked before the action goes to court, in the chat (0233)", () => {
  it("reads a question owed, and refuses a civil court's with no wording", () => {
    expect(
      chatQuestionOf({
        conversation_id: "w-1",
        kind: "free_justice",
        party_id: "p-1",
        party_name: "Bia Teste",
        own: false,
        appeal: false,
      }),
    ).toEqual({
      conversationId: "w-1",
      kind: "free_justice",
      partyId: "p-1",
      partyName: "Bia Teste",
      own: false,
      appeal: false,
      wording: null,
    });
    expect(chatQuestionOf({ conversation_id: "w-1", kind: "civil_court", party_id: "p-1" })).toBeNull();
    expect(chatQuestionOf({ conversation_id: "w-1", kind: "outro", party_id: "p-1" })).toBeNull();
  });

  it("asks free justice for the client or a child, and of an appeal", () => {
    const own = chatQuestionText({
      conversationId: "w-1",
      kind: "free_justice",
      partyId: "p-1",
      partyName: "Nídia Teste",
      own: true,
      appeal: false,
      wording: null,
    });
    expect(own).toContain("Antes de a ação ir para a Justiça, uma pergunta: você quer pedir a justiça gratuita?");
    expect(own).toContain("\n1. Quero pedir\n2. Não preciso\n3. O que é isso");
    const child = chatQuestionText({
      conversationId: "w-1",
      kind: "free_justice",
      partyId: "p-2",
      partyName: "Bia Teste",
      own: false,
      appeal: true,
      wording: null,
    });
    expect(child).toContain("Para o recurso, uma pergunta: você quer pedir a justiça gratuita para Bia?");
    expect(freeJusticeExplained()).toContain("Quer pedir?\n1. Quero pedir\n2. Não preciso");
    for (const text of [own, child, freeJusticeExplained()]) expect(text).not.toMatch(/[—–!]/);
  });

  it("shows the civil court's own wording and asks the acceptance", () => {
    const civil = chatQuestionText({
      conversationId: "w-1",
      kind: "civil_court",
      partyId: "p-1",
      partyName: "Nídia Teste",
      own: true,
      appeal: false,
      wording: "Texto de teste da vara cível.",
    });
    expect(civil).toBe(
      "A sua ação vai para a vara cível. Leia com calma:\n\nTexto de teste da vara cível.\n\nVocê aceita?\n1. Aceito\n2. Não aceito\n3. Tenho dúvidas",
    );
    expect(questionChoice("civil_court", "1")).toBe("sim");
    expect(questionChoice("civil_court", "não aceito")).toBe("nao");
    expect(questionChoice("free_justice", "3")).toBe("explicar");
    expect(questionChoice("free_justice", "talvez")).toBeNull();
    expect(questionAnswered("civil_court", false)).toContain("O escritório vai falar com você antes de seguir.");
  });

  it("writes the facts of the action in the chat to answer there, and keeps the link for long ones", () => {
    const asked = factsAskedMessage("Nídia", "Você comprou a passagem em 2099.");
    expect(asked).toBe(
      `Nídia, a sua ação está pronta para o escritório levar ao tribunal. Antes, confira se os fatos estão certos, do jeito que aconteceu:\n\nVocê comprou a passagem em 2099.\n\nEstá certo?\n${FACTS_LINE}`,
    );
    expect(factsAskedMessage("Nídia", "x".repeat(3001))).toContain("confira no seu link");
    expect(factsAskedMessage("Nídia")).toContain("confira no seu link");
    expect(factsReminderMessage("Nídia", true).endsWith(FACTS_LINE)).toBe(true);
    expect(factsChoice("1")).toBe("certo");
    expect(factsChoice("tem algo errado")).toBe("errado");
    expect(asked).not.toMatch(/[—–!]/);
  });
});

describe("who the holder of a bill is, in the chat (0237)", () => {
  it("asks it with the holder's first name, a bill of one's own offered first", () => {
    const question = chatQuestionOf({
      conversation_id: "w-1",
      kind: "residence",
      party_id: "p-1",
      party_name: "Lia Teste",
      own: true,
      wording: "Maria de Souza Teste",
    });
    expect(question?.kind).toBe("residence");
    expect(chatQuestionOf({ conversation_id: "w-1", kind: "residence", party_id: "p-1" })).toBeNull();
    const asked = chatQuestionText(question!);
    expect(asked.split("\n").slice(0, 2)).toEqual([
      "A conta de endereço que você mandou está em nome de Maria de Souza Teste. Se tiver uma conta no seu nome, pode mandar no lugar. Se não, quem é Maria para você?",
      "1. Mãe",
    ]);
    expect(residenceAsk("Maria de Souza Teste").split("\n")).toHaveLength(10);
    for (const text of [asked, residenceNoteAsk("Maria"), RESIDENCE_ANSWERED]) expect(text).not.toMatch(/[—–!]/);
  });

  it("reads the answer by its number, its label or the client's words", () => {
    expect(residenceChoice("1")).toBe("mae");
    expect(residenceChoice("é minha mãe")).toBe("mae");
    expect(residenceChoice("Cônjuge ou companheiro")).toBe("conjuge");
    expect(residenceChoice("minha tia")).toBe("parente");
    expect(residenceChoice("9")).toBe("outro");
    expect(residenceChoice("é a dona da pensão onde eu moro faz anos")).toBeNull();
    expect(residenceNoteOf("  minha   madrinha ")).toBe("minha madrinha");
    expect(residenceNoteOf("x")).toBeNull();
    expect(residenceNoteOf("pode ser qualquer pessoa?")).toBeNull();
  });
});
