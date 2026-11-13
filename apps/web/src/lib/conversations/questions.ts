import { choiceOf, type IntakeOption, optionsText } from "@/lib/conversations/intake";

/**
 * What the client is asked before the action goes to court, asked in the chat (migration 0233, the chat's script of
 * 2026-11-12): their word on free justice and on the civil court, one at a time, and the facts of the action to
 * confirm or correct. Pure: the database says what is owed and keeps the answer as on the link.
 */

export type ChatQuestionKind = "free_justice" | "civil_court" | "residence" | "account" | "leg";

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
  const kind =
    row.kind === "free_justice" ||
    row.kind === "civil_court" ||
    row.kind === "residence" ||
    row.kind === "account" ||
    row.kind === "leg"
      ? row.kind
      : null;
  const conversationId = text(row.conversation_id);
  const partyId = text(row.party_id);
  if (!kind || !conversationId || !partyId) return null;
  if ((kind === "civil_court" || kind === "residence" || kind === "leg") && !text(row.wording)) return null;
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
  if (question.kind === "account") return ACCOUNT_ASK;
  if (question.kind === "leg") return legAsk(question.wording ?? "");
  if (question.kind === "residence") {
    return `A conta de endereço que você mandou está em nome de ${question.wording ?? ""}. ${residenceAsk(question.wording ?? "")}`;
  }
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
export const questionChoice = (kind: "free_justice" | "civil_court", reply: string): string | null =>
  choiceOf(kind === "free_justice" ? FREE_JUSTICE_OPTIONS : CIVIL_OPTIONS, reply);

/** ONE's word once the answer is kept. */
export function questionAnswered(kind: "free_justice" | "civil_court", value: boolean): string {
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

// ---------- Who the holder of a bill is (0237) ----------

/**
 * Who the holder of a bill in somebody else's name is to the client, as the link asks it (0123): the relations its
 * declaration of residence says, the client's own words for anybody else.
 */
export const RESIDENCE_OPTIONS: readonly IntakeOption[] = [
  { value: "mae", label: "Mãe", words: ["mae", "minha mae", "mamae"] },
  { value: "pai", label: "Pai", words: ["pai", "meu pai", "papai"] },
  {
    value: "conjuge",
    label: "Cônjuge ou companheiro",
    words: [
      "conjuge",
      "marido",
      "esposa",
      "esposo",
      "companheiro",
      "companheira",
      "meu marido",
      "minha esposa",
      "minha mulher",
    ],
  },
  { value: "filho", label: "Filho ou filha", words: ["filho", "filha", "meu filho", "minha filha"] },
  { value: "irmao", label: "Irmão ou irmã", words: ["irmao", "irma", "meu irmao", "minha irma"] },
  { value: "avo", label: "Avô ou avó", words: ["avo", "vo", "vovo", "meu avo", "minha avo"] },
  {
    value: "parente",
    label: "Outro parente",
    words: [
      "outro parente",
      "parente",
      "tio",
      "tia",
      "primo",
      "prima",
      "sogro",
      "sogra",
      "cunhado",
      "cunhada",
      "meu tio",
      "minha tia",
      "meu primo",
      "minha prima",
      "meu sogro",
      "minha sogra",
    ],
  },
  {
    value: "proprietario",
    label: "Dono do imóvel",
    words: ["dono do imovel", "dono", "dona", "proprietario", "proprietaria", "locador", "locadora", "dono da casa"],
  },
  { value: "outro", label: "Outra pessoa", words: ["outra pessoa", "outro", "outra"] },
];

/** The question of who the holder is, after the bill was said back: a bill of one's own spares the declaration. */
export const residenceAsk = (holder: string): string =>
  `Se tiver uma conta no seu nome, pode mandar no lugar. Se não, quem é ${first(holder) || "essa pessoa"} para você?\n${optionsText(RESIDENCE_OPTIONS)}`;

/** What ONE asks after "Outra pessoa": the client's own words, which the declaration writes. */
export const residenceNoteAsk = (holder: string): string =>
  `Escreva em poucas palavras quem é ${first(holder) || "essa pessoa"} para você, por exemplo: minha madrinha.`;

/** What a reply chose for who the holder is; null when it is something else. */
export const residenceChoice = (reply: string): string | null => choiceOf(RESIDENCE_OPTIONS, reply);

/** The client's own words for "Outra pessoa", as the declaration keeps them (2 to 60 characters); null when not. */
export function residenceNoteOf(reply: string): string | null {
  const said = reply.trim().replace(/\s+/g, " ");
  return said.length >= 2 && said.length <= 60 && !said.includes("?") ? said : null;
}

/** ONE's word once the relation is kept: the declaration it prepares, signed with the other papers. */
export const RESIDENCE_ANSWERED =
  "Anotado. O escritório prepara uma declaração de residência, dizendo que você mora nesse endereço, para você assinar junto com os outros documentos.";

// ---------- The client's own account of what happened (0239) ----------

/**
 * What ONE asks once the papers are signed (the owner, 2026-11-13): the client tells what happened in their own words,
 * by audio or text, and ONE asks after it only what the action still lacks, one question at a time.
 */
export const ACCOUNT_ASK =
  "Agora me conte, do seu jeito, o que aconteceu na viagem: o que a companhia disse ou ofereceu, como você ficou esperando e o que perdeu ou gastou por causa disso. Pode mandar um áudio ou escrever aqui.";

/** What ONE says once the account arrived in writing: it is put in order, and what it lacks comes one at a time. */
export const ACCOUNT_RECEIVED =
  "Obrigado. Vou organizar o que você contou e, se faltar alguma informação para a ação, pergunto aqui, uma de cada vez.";

/** What ONE asks of a reply too short to be the account. */
export const ACCOUNT_SHORT =
  "Conte com um pouco mais de detalhes, por favor: o que aconteceu, o que a companhia disse ou ofereceu e o que você perdeu ou gastou. Se preferir, mande um áudio.";

// ---------- On which leg the problem was (0240) ----------

/** The legs as the database lists them (one a line, in the order of the trip), and "Não lembro" after them. */
export function legOptions(legs: string): IntakeOption[] {
  const lines = legs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [
    ...lines.map((line, index) => {
      const flight = line.split(",")[0]?.trim() ?? "";
      return { value: String(index + 1), label: line, words: flight ? [flight.toLowerCase()] : [] };
    }),
    { value: "0", label: "Não lembro", words: ["nao lembro", "nao sei", "nao me lembro"] },
  ];
}

/** ONE asks the client on which leg the problem was, never the firm: they were there. */
export const legAsk = (legs: string): string =>
  `Em qual destes voos aconteceu o problema?\n${optionsText(legOptions(legs))}`;

/** The leg a reply chose (its place in the list, 0 for "Não lembro"); null when it chose none. */
export function legChoice(legs: string, reply: string): number | null {
  const choice = choiceOf(legOptions(legs), reply);
  return choice === null ? null : Number(choice);
}

/** ONE's word once the client said it. */
export const legAnswered = (flight: string | null): string =>
  flight ? `Anotado: o problema foi no voo ${flight}.` : "Tudo bem. O ONE confere pelo registro oficial dos voos.";
