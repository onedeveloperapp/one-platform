/**
 * An answer of ONE to a passenger that waits for a person's "Enviar"
 * (migration 0048): the firm keeps ONE's answers to a person (`reply_client`
 * at `approval`, or the share checked at `sampled`). Pure: what the
 * conversation and the queue show of it, and what is approved when the
 * person changed it. Approved, the database sends it once, as ONE's answer
 * approved by that person (`one_send_approved_reply`).
 */

/** What a person reads of an answer of ONE that waits. */
export type WaitingReply = {
  approvalId: string;
  /** What ONE would answer; empty when it only asked for a person. */
  reply: string;
  /** Why ONE would have a person carry the conversation on, when it said so. */
  callPerson: string | null;
  /** When it entered the queue, already written on the reader's clock. */
  receivedLabel: string;
  /** The answer as the model gave it: a correction keeps its shape (`decide_approval`). */
  output: Record<string, unknown>;
};

/** The longest answer a person sends in a conversation, as the composer takes it. */
export const REPLY_MAX = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The answer of a run of the task, read for the screen. */
export function waitingReplyOf(approvalId: string, output: unknown, receivedLabel: string): WaitingReply {
  const answer = isRecord(output) ? output : {};
  const reply = typeof answer.resposta === "string" ? answer.resposta.trim() : "";
  const call = typeof answer.chamar_pessoa === "string" ? answer.chamar_pessoa.trim() : "";
  return { approvalId, reply, callPerson: call || null, receivedLabel, output: answer };
}

/** The words typed can go: something, within what a message takes. */
export function replyReady(typed: string): boolean {
  const text = typed.trim();
  return text.length > 0 && text.length <= REPLY_MAX;
}

/** What is approved: the answer as ONE wrote it (null), or with the words the person typed in its place. */
export function approvedOutput(waiting: WaitingReply, typed: string): Record<string, unknown> | null {
  const text = typed.trim();
  return text === waiting.reply ? null : { ...waiting.output, resposta: text };
}

/** Why an answer cannot go now, as the conversation stands; null when it can. */
export type ReplyBlock = "window" | "opted_out" | "number" | null;

export function replyBlock(conversation: {
  windowOpen: boolean;
  optedOut: boolean;
  numberActive: boolean;
}): ReplyBlock {
  if (conversation.optedOut) return "opted_out";
  if (!conversation.numberActive) return "number";
  if (!conversation.windowOpen) return "window";
  return null;
}

export const REPLY_BLOCK_KEY: Record<Exclude<ReplyBlock, null>, string> = {
  window: "reply-blocked-window",
  opted_out: "reply-blocked-opted-out",
  number: "reply-blocked-number",
};

/** The words of an answer approved that did not go, by what the database answered. */
export function notSentKey(code: string): string {
  if (code === "window_closed") return "reply-not-sent-window";
  if (code === "opted_out") return "reply-not-sent-opted-out";
  if (code === "number_disconnected") return "reply-not-sent-number";
  return "reply-not-sent-failed";
}

/** The reason a person's "Descartar" leaves on the record: a refusal always says why. */
export const DISCARD_NOTE = "Descartada por uma pessoa do escritório.";
