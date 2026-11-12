import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * What the webhook of a firm's inbox carries to ONE (`WebhookListener#deliver_api_inbox_webhooks` of Chatwoot
 * 4.19.1): every message written in the inbox's conversations and every change of their status, signed with the
 * inbox's secret. Pure: the signature, and the events ONE acts on, read from the payload.
 */

/** How far a delivery's moment may be from now: past it, the delivery is refused as a replay. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Whether the delivery is the inbox's: `X-Chatwoot-Signature` is `sha256=` and the HMAC SHA-256, in hex, of
 * `"<X-Chatwoot-Timestamp>.<raw body>"` under the inbox's secret (`Webhooks::Trigger#request_headers`).
 */
export function verifyChatwootSignature(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  secret: string;
  /** Seconds since 1970. */
  now: number;
}): boolean {
  const { rawBody, timestamp, signature, secret, now } = input;
  if (!timestamp || !signature || !secret) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  const given = Buffer.from(match[1]!.toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** A message a person of the firm wrote in the panel: ONE sends it to the client through its outbox. */
export type PersonMessageEvent = {
  type: "person_message";
  accountId: number;
  inboxId: number | null;
  conversationId: number;
  messageId: number;
  /** The person's id in Chatwoot. */
  senderId: number;
  content: string;
  /** How many files go with it. */
  attachments: number;
  sourceId: string | null;
};

/** The status of a conversation changed in the panel: open is a person's, pending or resolved goes back to ONE. */
export type StatusEvent = {
  type: "status";
  accountId: number;
  inboxId: number | null;
  conversationId: number;
  status: "open" | "pending" | "resolved" | "snoozed";
};

export type ChatwootEvent = PersonMessageEvent | StatusEvent | { type: "ignored"; reason: string };

/** ONE's own mark on what it writes into the panel, carried back in the message's `source_id`. */
export const ONE_SOURCE_PREFIX = "one:";

export function oneSourceId(messageId: string): string {
  return `${ONE_SOURCE_PREFIX}${messageId}`;
}

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : typeof value === "string" && /^\d{1,15}$/.test(value)
      ? Number(value)
      : null;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** The account a delivery says it is of, read before the signature to find the inbox's secret. */
export function accountOfDelivery(payload: unknown): number | null {
  return asNumber(record(record(payload)?.account)?.id);
}

/**
 * The event ONE acts on, or why it does not. A message counts only when a person of the panel wrote it to the
 * client: not a private note, not what came from the client, not what ONE wrote itself (its `source_id`), not an
 * automation's nor a bot's. A status counts in any of the four Chatwoot has.
 */
export function parseChatwootDelivery(payload: unknown): ChatwootEvent {
  const body = record(payload);
  if (!body) return { type: "ignored", reason: "not_an_object" };
  const accountId = accountOfDelivery(body);
  if (!accountId) return { type: "ignored", reason: "no_account" };
  const event = typeof body.event === "string" ? body.event : "";

  if (event === "message_created") {
    if (body.private === true) return { type: "ignored", reason: "private" };
    if (body.message_type !== "outgoing") return { type: "ignored", reason: "not_outgoing" };
    const sourceId = typeof body.source_id === "string" && body.source_id ? body.source_id : null;
    if (sourceId?.startsWith(ONE_SOURCE_PREFIX)) return { type: "ignored", reason: "written_by_one" };
    const sender = record(body.sender);
    if (sender?.type !== "user") return { type: "ignored", reason: "not_a_person" };
    const attributes = record(body.content_attributes);
    if (attributes?.automation_rule_id || attributes?.campaign_id) return { type: "ignored", reason: "automation" };
    const senderId = asNumber(sender.id);
    const conversation = record(body.conversation);
    const conversationId = asNumber(conversation?.id);
    const messageId = asNumber(body.id);
    if (!senderId || !conversationId || !messageId) return { type: "ignored", reason: "incomplete" };
    const attachments = Array.isArray(body.attachments) ? body.attachments.length : 0;
    return {
      type: "person_message",
      accountId,
      inboxId: asNumber(record(body.inbox)?.id) ?? asNumber(conversation?.inbox_id),
      conversationId,
      messageId,
      senderId,
      content: typeof body.content === "string" ? body.content : "",
      attachments,
      sourceId,
    };
  }

  if (event === "conversation_status_changed") {
    const conversationId = asNumber(body.id);
    const status = body.status;
    if (!conversationId) return { type: "ignored", reason: "incomplete" };
    if (status !== "open" && status !== "pending" && status !== "resolved" && status !== "snoozed") {
      return { type: "ignored", reason: "unknown_status" };
    }
    return { type: "status", accountId, inboxId: asNumber(body.inbox_id), conversationId, status };
  }

  return { type: "ignored", reason: event ? `event_${event}`.slice(0, 60) : "no_event" };
}
