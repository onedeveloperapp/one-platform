import { choiceOf, type IntakeOption, optionsText } from "@/lib/conversations/intake";

/**
 * What the client is asked before the action goes to court, asked in the chat (migration 0233, the chat's script of
 * 2026-11-12): their word on free justice and on the civil court, one at a time, and the facts of the action to
 * confirm or correct. Pure: the database says what is owed and keeps the answer as on the link.
 */

export type ChatQuestionKind = "free_justice" | "civil_court";

export type ChatQuestion = {
  conversationId: string;
  kind: ChatQuestionKind;
  partyId: string;
  partyName: string;
  own: boolean;
  appeal: boolean;
  wording: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** A row of `chat_questions_owed`, read; null when it is not one. */
export function chatQuestionOf(raw: unknown): ChatQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const kind = row.kind === "free_justice" || row.kind === "civil_court" ? row.kind : null;
  const conversationId = text(row.conversation_id);
  const partyId = text(row.party_id);
  if (!kind || !conversationId || !partyId) return null;
  if (kind === "civil_court" && !text(row.wording)) return null;
  return {
    conversationId,
    kind,
    partyId,
    partyName: text(row.party_name) ?? "",
    own: row.own === true,
    appeal: row.appeal === true,
    wording: text(row.wording),
  };
}

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

export const FREE_JUSTICE_OPTIONS: readonly IntakeOption[] = [
  { value: "sim", label: "Quero pedir", words: ["quero pedir", "quero", "sim", "pedir"] },
  { value: "nao", label: "Não preciso", words: ["nao preciso", "nao", "nao quero"] },
  { value: "explicar", label: "O que é isso", words: ["o que e isso", "o que e", "nao entendi", "explica"] },
];

export const CIVIL_OPTIONS: readonly IntakeOption[] = [
  { value: "sim", label: "Aceito", words: ["aceito", "sim", "concordo"] },
  { value: "nao", label: "Não aceito", words: ["nao aceito", "nao", "nao concordo"] },
  { value: "duvidas", label: "Tenho dúvidas", words: ["tenho duvidas", "duvida", "duvidas"] },
];

const FREE_JUSTICE_WHAT =
  "A justiça gratuita dispensa de pagar as custas do processo, como as taxas do tribunal. Quem pede declara que não pode pagar sem prejudicar o próprio sustento ou o da família, e o juiz decide se concede.";

/** ONE's question for a word the client owes. */
export function chatQuestionText(question: ChatQuestion): string {
  const whose = question.own ? "" : ` para ${first(question.partyName)}`;
  if (question.kind === "free_justice") {
    const when = question.appeal ? "Para o recurso" : "Antes de a ação ir para a Justiça";
    return [
      `${when}, uma pergunta: você quer pedir a justiça gratuita${whose}?`,
      "Ela é para quem não pode pagar as custas do processo sem prejudicar o próprio sustento. Se pedir, você assina uma declaração.",
    ]
      .join(" ")
      .concat(`\n${optionsText(FREE_JUSTICE_OPTIONS)}`);
  }
  const lead = question.own
    ? "A sua ação vai para a vara cível. Leia com calma:"
    : `A ação de ${first(question.partyName)} vai para a vara cível. Leia com calma:`;
  return `${lead}\n\n${question.wording ?? ""}\n\nVocê aceita?\n${optionsText(CIVIL_OPTIONS)}`;
}

/** What free justice is, and the question again with the two answers. */
export const freeJusticeExplained = (): string =>
  `${FREE_JUSTICE_WHAT} Quer pedir?\n${optionsText(FREE_JUSTICE_OPTIONS.slice(0, 2))}`;

/** What a reply chose for the question that waits; null when it is something else. */
export const questionChoice = (kind: ChatQuestionKind, reply: string): string | null =>
  choiceOf(kind === "free_justice" ? FREE_JUSTICE_OPTIONS : CIVIL_OPTIONS, reply);

/** ONE's word once the answer is kept. */
export function questionAnswered(kind: ChatQuestionKind, value: boolean): string {
  if (kind === "free_justice") {
    return value
      ? "Anotado: você pede a justiça gratuita. A declaração para assinar chega por aqui."
      : "Anotado: você não pede a justiça gratuita.";
  }
  return value
    ? "Anotado: você aceita a ação na vara cível."
    : "Anotado: você não aceita. O escritório vai falar com você antes de seguir.";
}

// ---------- The facts of the action (0182), answered in the chat ----------

export const FACTS_OPTIONS: readonly IntakeOption[] = [
  { value: "certo", label: "Está certo", words: ["sim", "certo", "esta certo", "confirmo", "correto", "ok"] },
  { value: "errado", label: "Tem algo errado", words: ["tem algo errado", "errado", "nao", "nao esta certo"] },
];

/** The last line of ONE's message on the facts: how the next turn knows its answer. */
export const FACTS_LINE = optionsText(FACTS_OPTIONS);

/** What ONE asks after "Tem algo errado". */
export const FACTS_CORRECTION =
  "Diga o que está errado nos fatos, do seu jeito. O escritório corrige a ação e te mostra de novo.";

/** ONE's word once the client confirmed the facts, or told what is wrong. */
export const FACTS_CONFIRMED = "Obrigado. Com os fatos confirmados, o escritório leva a sua ação à Justiça.";
export const FACTS_CORRECTED = "Obrigado. O escritório corrige a ação e te mostra os fatos de novo por aqui.";
export const FACTS_TOO_SHORT = "Conte um pouco mais do que está errado, para o escritório corrigir certo.";

/** What a reply to the facts chose; null when it is something else. */
export const factsChoice = (reply: string): string | null => choiceOf(FACTS_OPTIONS, reply);
