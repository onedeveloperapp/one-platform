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

/** The points a piece of a flight problem needs of the account, in the order a person tells them. */
export const ACCOUNT_TOPICS = [
  "compra",
  "aviso",
  "solucao",
  "chegada",
  "assistencia",
  "gastos",
  "consequencias",
] as const;
export type AccountTopic = (typeof ACCOUNT_TOPICS)[number];

export const isAccountTopic = (value: unknown): value is AccountTopic =>
  (ACCOUNT_TOPICS as readonly unknown[]).includes(value);

/** Each point as the client reads it, when the link tells them what to tell. */
export const ACCOUNT_TOPIC_KEY: Record<AccountTopic, string> = {
  compra: "account-topic-compra",
  aviso: "account-topic-aviso",
  solucao: "account-topic-solucao",
  chegada: "account-topic-chegada",
  assistencia: "account-topic-assistencia",
  gastos: "account-topic-gastos",
  consequencias: "account-topic-consequencias",
};

/** Each point in a few words, as the firm reads what an account still lacks. */
export const ACCOUNT_TOPIC_SHORT_KEY: Record<AccountTopic, string> = {
  compra: "account-topic-short-compra",
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
