/**
 * The client's account of what happened, as ONE waits for it before it creates the lawsuits (migration 0090): where
 * a case's account stands (`case_account_state`, the database's one reading of it), the points a piece of a flight
 * problem needs of it (the setting `statements.account_topics`) and their words (`product` namespace). Pure.
 */

/**
 * Where a case's account stands:
 * - `missing`: the client told nothing yet;
 * - `preparing`: an account is on its way or ONE is ordering it;
 * - `proposed`: an order of the facts waits for a person of the firm;
 * - `incomplete`: the order says something the piece needs is missing, and the client is asked it on their link;
 * - `contested`: the client said the order is wrong past the rounds ONE orders it again by itself;
 * - `failed`: nothing of it could be ordered (an audio not transcribed, an order turned down);
 * - `ready`: an order approved or confirmed with nothing missing, or with the client asked as often as allowed.
 */
export const ACCOUNT_STATES = [
  "missing",
  "preparing",
  "proposed",
  "incomplete",
  "contested",
  "failed",
  "ready",
] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

export const isAccountState = (value: unknown): value is AccountState =>
  (ACCOUNT_STATES as readonly unknown[]).includes(value);

/** The state the database answered, or null for an answer that is none. */
export const accountStateOf = (value: unknown): AccountState | null => (isAccountState(value) ? value : null);

/**
 * The points a piece of a flight problem needs of the account, in the order a person tells them. Never the purchase
 * (the owner, 2026-11-04): the piece speaks of it only where a document says it (0097).
 */
export const ACCOUNT_TOPICS = ["aviso", "solucao", "chegada", "assistencia", "gastos", "consequencias"] as const;
export type AccountTopic = (typeof ACCOUNT_TOPICS)[number];

export const isAccountTopic = (value: unknown): value is AccountTopic =>
  (ACCOUNT_TOPICS as readonly unknown[]).includes(value);

/** Each point as the client reads it, when the link tells them what to tell. */
export const ACCOUNT_TOPIC_KEY: Record<AccountTopic, string> = {
  aviso: "account-topic-aviso",
  solucao: "account-topic-solucao",
  chegada: "account-topic-chegada",
  assistencia: "account-topic-assistencia",
  gastos: "account-topic-gastos",
  consequencias: "account-topic-consequencias",
};

/** Each point in a few words, as the firm reads what an account still lacks. */
export const ACCOUNT_TOPIC_SHORT_KEY: Record<AccountTopic, string> = {
  aviso: "account-topic-short-aviso",
  solucao: "account-topic-short-solucao",
  chegada: "account-topic-short-chegada",
  assistencia: "account-topic-short-assistencia",
  gastos: "account-topic-short-gastos",
  consequencias: "account-topic-short-consequencias",
};

/**
 * What the client is asked to do about their account: tell it, or answer what is missing of it; nothing while ONE or
 * the firm holds it, or once it is ready.
 */
export function accountAsksClient(state: AccountState | null): "tell" | "answer" | null {
  if (state === "missing") return "tell";
  if (state === "incomplete") return "answer";
  return null;
}

/** How a question of the account is numbered in the chat, so the next turn knows which one an answer is of. */
const ACCOUNT_QUESTION = /^Pergunta (\d+) de (\d+): /m;

/** One question of the account, numbered: "Pergunta 2 de 4: …". */
export const accountQuestionLine = (index: number, total: number, question: string): string =>
  `Pergunta ${index} de ${total}: ${question.trim()}`;

/**
 * ONE's message in the client's WhatsApp conversation with what their account is missing (0092), one question at a
 * time (0235): the first question, with what it is for and how to answer; the next ones come one after each answer.
 * The client reads the firm, never ONE.
 */
export function accountQuestionsMessage(firstName: string, questions: readonly string[]): string {
  const name = firstName.trim();
  const lead = name
    ? `${name}, para preparar a sua ação, o escritório precisa saber mais algumas coisas. Vou perguntar uma de cada vez, e se não lembrar de algo, é só dizer.`
    : "Para preparar a sua ação, o escritório precisa saber mais algumas coisas. Vou perguntar uma de cada vez, e se não lembrar de algo, é só dizer.";
  return [lead, accountQuestionLine(1, questions.length, questions[0] ?? "")].join("\n");
}

/** The question a message of ONE asks, by its number; null when it asks none of the account. */
export function accountQuestionOf(text: string): { index: number; total: number } | null {
  const match = ACCOUNT_QUESTION.exec(text);
  return match ? { index: Number(match[1]), total: Number(match[2]) } : null;
}

/**
 * The client's answers, put together for the account (0235): each question ONE asked since its first, with the words
 * the client wrote after it. The order of the facts reads it as it reads an answer on the link.
 */
export function accountAnswersText(
  messages: readonly { author: string; text: string }[],
  questions: readonly string[],
): string {
  let start = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const asked = messages[index].author === "one" ? accountQuestionOf(messages[index].text) : null;
    if (asked?.index === 1) {
      start = index;
      break;
    }
  }
  if (start < 0) return "";
  const answers = new Map<number, string[]>();
  let current = 0;
  for (const message of messages.slice(start)) {
    if (message.author === "one") {
      // Words written after another message of ONE answer that one, not the account.
      current = accountQuestionOf(message.text)?.index ?? 0;
      continue;
    }
    if (message.author === "cliente" && current > 0 && message.text.trim()) {
      answers.set(current, [...(answers.get(current) ?? []), message.text.trim()]);
    }
  }
  return questions
    .map((question, index) => `${question.trim()}\n${(answers.get(index + 1) ?? []).join(" ") || "Não respondeu."}`)
    .join("\n\n");
}

/** What ONE says when it comes back to a question of the account that waits, after another step. */
export const accountBackLine = "Voltando ao seu relato:";

/** ONE's word once the client answered in the conversation: the account is ordered again with it. */
export function accountThanksMessage(firstName: string): string {
  const name = firstName.trim();
  return `${name ? `Obrigado, ${name}.` : "Obrigado."} Recebi as suas respostas e vou organizar o seu relato com elas.`;
}

/**
 * Where an account stands, as a line of what a case still lacks, for the firm: nothing while ONE orders it or once
 * it is ready (ONE's work is never the firm's task).
 */
export const ACCOUNT_MISSING_KEY: Partial<Record<AccountState, string>> = {
  missing: "case-missing-account-missing",
  incomplete: "case-missing-account-incomplete",
  proposed: "case-missing-account-proposed",
  contested: "case-missing-account-contested",
  failed: "case-missing-account-failed",
};

/**
 * Which questions of the account the client answered in the chat since ONE first asked them (0235): the numbers of
 * those with words after them. ONE asks next the first one not answered.
 */
export function accountAnswered(messages: readonly { author: string; text: string }[]): Set<number> {
  const answered = new Set<number>();
  let started = false;
  let current = 0;
  for (const message of messages) {
    if (message.author === "one") {
      const asked = accountQuestionOf(message.text);
      if (asked?.index === 1 && !started) started = true;
      current = asked?.index ?? 0;
      continue;
    }
    if (started && message.author === "cliente" && current > 0 && message.text.trim()) answered.add(current);
  }
  return answered;
}
