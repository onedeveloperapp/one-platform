import { createHmac, timingSafeEqual } from "node:crypto";

import type { InboundKind, InboundMedia, WhatsAppEvent } from "@flyee/whatsapp/types";

/**
 * Reading what the vendor sends to the one webhook of the platform.
 *
 * Two things, both pure: whether a delivery is authentic (`verifySignature`,
 * over the RAW body, in constant time) and what it says (`parseWebhook`,
 * which turns the vendor's payload into the platform's own events and drops
 * what it does not know). Neither touches a database: the route decides what
 * to do with each event, after routing it to its firm by the number.
 *
 * The shapes follow the Cloud API reference read on 2026-10-09: `messages`
 * (messages and statuses), and the coexistence fields `smb_message_echoes`,
 * `smb_app_state_sync` and `history`, plus `account_update` and
 * `message_template_status_update`; and `template_category_update`, read on
 * 2026-10-11.
 */

/** Signs a raw body the way the vendor does: `sha256=<hex of the HMAC>`. Used by the simulator and by tests. */
export function signWebhook(rawBody: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
}

/**
 * True when the `X-Hub-Signature-256` header is the HMAC of the raw body under
 * the secret. Compared in constant time: a comparison that stops at the first
 * wrong character tells a forger how much of a guess was right.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!secret) return false;
  const header = signatureHeader ?? "";
  const provided = header.startsWith("sha256=") ? header.slice(7) : "";
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(provided.toLowerCase(), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const digits = (value: unknown): string => String(value ?? "").replace(/\D/g, "");

/** A Unix time in seconds, as the vendor sends it (a string or a number). */
function moment(value: unknown): Date | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
}

const KINDS: readonly InboundKind[] = [
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "reaction",
  "interactive",
  "button",
  "system",
  "unsupported",
];

const MEDIA_KINDS: readonly InboundKind[] = ["image", "document", "audio", "video", "sticker"];

/** What a message is and what it says: its text, the caption of a media, or the label of what the person tapped. */
function contentOf(message: Json): { kind: InboundKind; body: string | null; media: InboundMedia | null } {
  const type = text(message.type) ?? "unsupported";
  const kind: InboundKind = (KINDS as readonly string[]).includes(type) ? (type as InboundKind) : "unsupported";
  const part = isObject(message[kind]) ? (message[kind] as Json) : {};

  if (kind === "text") return { kind, body: text(part.body), media: null };
  if (MEDIA_KINDS.includes(kind)) {
    const id = text(part.id);
    return {
      kind,
      body: text(part.caption),
      media: id ? { id, mimeType: text(part.mime_type), filename: text(part.filename) } : null,
    };
  }
  if (kind === "interactive") {
    const reply = isObject(part.button_reply) ? part.button_reply : isObject(part.list_reply) ? part.list_reply : {};
    return { kind, body: text(reply.title), media: null };
  }
  if (kind === "button") return { kind, body: text(part.text), media: null };
  if (kind === "reaction") return { kind, body: text(part.emoji), media: null };
  if (kind === "location") {
    const where = [text(part.name), text(part.address)].filter(Boolean).join(", ");
    return { kind, body: where || null, media: null };
  }
  if (kind === "system") return { kind, body: text(part.body), media: null };
  return { kind, body: null, media: null };
}

const STATUSES = ["sent", "delivered", "read", "failed"] as const;
type DeliveryStatus = (typeof STATUSES)[number];
const isStatus = (value: unknown): value is DeliveryStatus => (STATUSES as readonly unknown[]).includes(value);

/** What the history says became of a message, in the platform's own statuses. */
function historyStatus(value: unknown): DeliveryStatus | null {
  const status = String(value ?? "").toLowerCase();
  if (status === "error") return "failed";
  if (status === "played") return "read";
  return isStatus(status) ? status : null;
}

/** Every event of a webhook delivery, in order. An unknown field or shape yields nothing, never an exception. */
export function parseWebhook(body: unknown): WhatsAppEvent[] {
  const events: WhatsAppEvent[] = [];
  if (!isObject(body) || body.object !== "whatsapp_business_account") return events;

  for (const entry of list(body.entry)) {
    const wabaId = text(entry.id) ?? "";
    for (const change of list(entry.changes)) {
      const field = text(change.field);
      const value = isObject(change.value) ? change.value : {};
      const metadata = isObject(value.metadata) ? value.metadata : {};
      const phoneNumberId = text(metadata.phone_number_id) ?? "";

      if (field === "messages" && phoneNumberId) {
        const names = new Map(
          list(value.contacts).map((contact) => [
            digits(contact.wa_id),
            isObject(contact.profile) ? text(contact.profile.name) : null,
          ]),
        );
        for (const message of list(value.messages)) {
          const from = digits(message.from);
          const id = text(message.id);
          if (!from || !id) continue;
          const context = isObject(message.context) ? message.context : {};
          events.push({
            type: "message",
            phoneNumberId,
            from,
            contactName: names.get(from) ?? null,
            providerMessageId: id,
            ...contentOf(message),
            replyTo: text(context.id),
            timestamp: moment(message.timestamp),
          });
        }
        for (const status of list(value.statuses)) {
          const id = text(status.id);
          if (!id || !isStatus(status.status)) continue;
          const pricing = isObject(status.pricing) ? status.pricing : {};
          const error = list(status.errors)[0];
          events.push({
            type: "status",
            phoneNumberId,
            providerMessageId: id,
            status: status.status,
            errorCode: error && error.code !== undefined ? String(error.code) : null,
            pricingCategory: text(pricing.category),
            pricingType: text(pricing.type),
          });
        }
      } else if (field === "smb_message_echoes" && phoneNumberId) {
        for (const echo of list(value.message_echoes)) {
          const to = digits(echo.to);
          const id = text(echo.id);
          const type = text(echo.type);
          // An edit or a deletion made on the phone names another message; mirroring those is not done yet.
          if (!to || !id || type === "revoke" || type === "edit") continue;
          const content = contentOf(echo);
          events.push({
            type: "echo",
            phoneNumberId,
            to,
            providerMessageId: id,
            kind: content.kind,
            body: content.body,
            timestamp: moment(echo.timestamp),
          });
        }
      } else if (field === "smb_app_state_sync" && phoneNumberId) {
        for (const item of list(value.state_sync)) {
          if (item.type !== "contact" || !isObject(item.contact)) continue;
          const contact = digits(item.contact.phone_number);
          if (!contact) continue;
          events.push({
            type: "contact",
            phoneNumberId,
            contact,
            name: text(item.contact.full_name) ?? text(item.contact.first_name),
            action: item.action === "remove" ? "remove" : "add",
          });
        }
      } else if (field === "history" && phoneNumberId) {
        for (const chunk of list(value.history)) {
          if (list(chunk.errors).length > 0) {
            events.push({ type: "history_declined", phoneNumberId });
            continue;
          }
          const progress = isObject(chunk.metadata) ? Number(chunk.metadata.progress) : Number.NaN;
          events.push({
            type: "history",
            phoneNumberId,
            progress: Number.isFinite(progress) ? progress : null,
            threads: list(chunk.threads).flatMap((thread) => {
              const contact = digits(thread.id);
              if (!contact) return [];
              const messages = list(thread.messages).flatMap((message) => {
                const id = text(message.id);
                // A media of the history arrives later, on its own: the placeholder says nothing.
                if (!id || message.type === "media_placeholder") return [];
                const content = contentOf(message);
                const context = isObject(message.history_context) ? message.history_context : {};
                return [
                  {
                    providerMessageId: id,
                    direction: digits(message.from) === contact ? ("in" as const) : ("out" as const),
                    kind: content.kind,
                    body: content.body,
                    status: historyStatus(context.status),
                    timestamp: moment(message.timestamp),
                  },
                ];
              });
              return [{ contact, messages }];
            }),
          });
        }
      } else if (field === "account_update") {
        const event = text(value.event);
        const info = isObject(value.waba_info) ? value.waba_info : {};
        const disconnection = isObject(value.disconnection_info) ? value.disconnection_info : {};
        const account = text(info.waba_id) ?? wabaId;
        if (event && account) {
          events.push({ type: "account", wabaId: account, event, reason: text(disconnection.reason) });
        }
      } else if (field === "message_template_status_update") {
        const name = text(value.message_template_name);
        const status = text(value.event);
        if (wabaId && name && status) {
          events.push({
            type: "template_status",
            wabaId,
            name,
            language: text(value.message_template_language),
            status,
          });
        }
      } else if (field === "template_category_update") {
        // Two forms share the field: a change announced (`correct_category`, and the day it takes effect, with
        // `new_category` saying the category it has now) and a change made (`previous_category` and
        // `new_category`). Only the change made is a category the template has.
        const name = text(value.message_template_name);
        const category = text(value.new_category);
        const announced = value.category_update_timestamp !== undefined || value.correct_category !== undefined;
        if (wabaId && name && category && !announced) {
          events.push({
            type: "template_category",
            wabaId,
            name,
            language: text(value.message_template_language),
            category,
          });
        }
      }
    }
  }
  return events;
}
