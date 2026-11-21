import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  AccountTemplate,
  InboundKind,
  MediaResult,
  OutboundMessage,
  ProfileUpdated,
  SendResult,
  TemplateCreated,
  TemplateSubmission,
  WhatsAppEvent,
  WhatsAppProvider,
} from "@flyee/whatsapp/types";

/**
 * A number connected through WhatsApp Web, by the platform's OpenWA (MIT, version 0.29.1; its API specification,
 * docs/06-api-specification.md, read on 2026-11-11): one session of OpenWA per number of a firm, the number linked
 * as a device of the phone by reading a QR. It is the unofficial way, the firm's choice after accepting its risk
 * (the owner, 2026-11-11): WhatsApp may ban the number, the phone must stay on and online, and there are no
 * templates, so nothing goes outside the 24 hours a person's message opens (the database decides that, as for the
 * official API).
 *
 * As the official provider, it carries a message already reserved and says what came of it, as a code and never as
 * the gateway's text. The key is the platform's (`OPENWA_API_KEY`, the server's environment), sent only in the
 * `X-API-Key` header; the session is the number's (`wa_numbers.phone_number_id`).
 */

export interface OpenWaConfig {
  /** The OpenWA the server reaches (`https://wa.<domain>`): only its `/api/*` is public. */
  baseUrl: string;
  apiKey: string;
  /** The session's id (a UUID), the number's in ONE. */
  sessionId: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type Answer = { status: number; body: unknown; bytes: Uint8Array | null; contentType: string | null };

/** One call to OpenWA: null when nothing came back (a timeout, a connection that dropped). */
async function call(
  config: { baseUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number },
  path: string,
  init: { method: string; body?: unknown; raw?: boolean },
): Promise<Answer | null> {
  const doFetch = config.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 20_000);
  try {
    const response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/api/${path}`, {
      method: init.method,
      headers: {
        "X-API-Key": config.apiKey,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    if (init.raw && response.ok) {
      return { status: response.status, body: null, bytes: new Uint8Array(await response.arrayBuffer()), contentType };
    }
    const text = await response.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, bytes: null, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const codeOf = (body: unknown): string | null => {
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Z0-9_]{2,60}$/.test(code) ? code.toLowerCase() : null;
};

/** A phone as WhatsApp Web names a person's chat. */
export const chatIdOf = (phone: string): string => `${phone.replace(/\D/g, "")}@c.us`;

/** What OpenWA answered a send, in the words the outbox records (`SendError`). */
export function openWaSendResult(answer: Answer | null): SendResult {
  // No answer at all: the gateway may have sent it before the line went quiet.
  if (!answer) return { ok: false, error: "unconfirmed", detail: "no_answer" };
  const id = (answer.body as { messageId?: unknown } | null)?.messageId;
  if (answer.status >= 200 && answer.status < 300) {
    return typeof id === "string" && id
      ? { ok: true, providerMessageId: id }
      : { ok: false, error: "rejected", detail: "no_message_id" };
  }
  const code = codeOf(answer.body);
  const detail = code ? `openwa_${code}` : `http_${answer.status}`;
  if (answer.status === 401 || answer.status === 403) return { ok: false, error: "token_invalid", detail };
  if (answer.status === 429) return { ok: false, error: "rate_limited", detail };
  // The specification: a 503, a 502 or a 504 on a write may still have applied it.
  if (answer.status === 502 || answer.status === 503 || answer.status === 504)
    return { ok: false, error: "unconfirmed", detail };
  if (answer.status === 404 && code !== "session_not_found") return { ok: false, error: "invalid_recipient", detail };
  if (answer.status >= 500) return { ok: false, error: "unconfirmed", detail };
  // A session not ready (the phone unlinked, a QR to read again): the message did not go, and may later.
  if (answer.status === 409 || code === "session_not_ready" || code === "session_not_found") {
    return { ok: false, error: "unavailable", detail };
  }
  return { ok: false, error: "rejected", detail };
}

export class OpenWaProvider implements WhatsAppProvider {
  readonly name = "openwa" as const;
  private readonly config: OpenWaConfig;

  constructor(config: OpenWaConfig) {
    this.config = config;
  }

  private path(rest: string): string {
    return `sessions/${encodeURIComponent(this.config.sessionId)}/${rest}`;
  }

  async send(to: string, message: OutboundMessage): Promise<SendResult> {
    const recipient = to.replace(/\D/g, "");
    if (recipient.length < 8 || recipient.length > 15) return { ok: false, error: "invalid_recipient" };
    const chatId = chatIdOf(recipient);
    if (message.kind === "template") {
      // WhatsApp Web has no templates: the database never reserves one for such a number.
      return { ok: false, error: "rejected", detail: "template_unsupported" };
    }
    if (message.kind === "text") {
      return openWaSendResult(
        await call(this.config, this.path("messages/send-text"), {
          method: "POST",
          body: { chatId, text: message.text, linkPreview: false },
        }),
      );
    }
    const route = message.kind === "image" ? "messages/send-image" : "messages/send-document";
    return openWaSendResult(
      await call(this.config, this.path(route), {
        method: "POST",
        body: {
          chatId,
          url: message.url,
          ...(message.caption ? { caption: message.caption.slice(0, 1024) } : {}),
          ...(message.kind === "document" && message.filename ? { filename: message.filename.slice(0, 255) } : {}),
        },
      }),
    );
  }

  /** A media a person sent, by the id this provider gave it (`<chatId>|<messageId>`). */
  async fetchMedia(mediaId: string): Promise<MediaResult> {
    const [chatId, messageId] = mediaId.split("|");
    if (!chatId || !messageId) return { kind: "gone" };
    const answer = await call(
      { ...this.config, timeoutMs: this.config.timeoutMs ?? 60_000 },
      this.path(`messages/${encodeURIComponent(chatId)}/${encodeURIComponent(messageId)}/media`),
      { method: "GET", raw: true },
    );
    if (!answer) return { kind: "later", detail: "no_answer" };
    if (answer.status === 404) return { kind: "gone" };
    if (answer.status !== 200 || !answer.bytes) return { kind: "later", detail: `http_${answer.status}` };
    const mime = (answer.contentType ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
    return { kind: "fetched", bytes: answer.bytes, mime };
  }

  async listTemplates(): Promise<AccountTemplate[]> {
    return [];
  }

  /** The platform's OpenWA sets no business profile: the firm keeps the one of its phone's WhatsApp. */
  async updateProfile(): Promise<ProfileUpdated> {
    return { ok: false, code: "not_supported" };
  }

  async createTemplate(submission: TemplateSubmission): Promise<TemplateCreated> {
    void submission;
    return { ok: false, code: "unsupported" };
  }
}

// ---------- The sessions: one per number ----------

/** A session as OpenWA reports it: its state, the phone linked once it is ready, and what WhatsApp restricted. */
export type OpenWaSession = {
  id: string;
  status: string;
  phone: string | null;
  restricted: boolean;
};

const sessionOf = (raw: unknown): OpenWaSession | null => {
  const row = (raw ?? {}) as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id) return null;
  const restriction = row.restriction as { active?: unknown } | null | undefined;
  return {
    id: row.id,
    status: typeof row.status === "string" ? row.status : "unknown",
    phone: typeof row.phone === "string" && row.phone ? row.phone.replace(/\D/g, "") : null,
    restricted: restriction?.active === true,
  };
};

/** The session API of the platform's OpenWA, with its key: what connecting a number by its QR needs. */
export function openWaSessions(config: { baseUrl: string; apiKey: string; fetch?: typeof fetch; timeoutMs?: number }) {
  return {
    /** A new session under a name of letters, digits and hyphens (3 to 50); null when OpenWA did not take it. */
    async create(name: string): Promise<OpenWaSession | null> {
      const answer = await call(config, "sessions", { method: "POST", body: { name } });
      return answer && answer.status >= 200 && answer.status < 300 ? sessionOf(answer.body) : null;
    },
    async start(sessionId: string): Promise<boolean> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}/start`, { method: "POST" });
      // Already starting or showing its QR: the gateway answers 400, and the session is on its way.
      return Boolean(answer && (answer.status < 300 || answer.status === 400));
    },
    /** The session, or null when it is gone (`missing`) or OpenWA did not answer (`unknown`). */
    async read(sessionId: string): Promise<OpenWaSession | "missing" | null> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}`, { method: "GET" });
      if (!answer) return null;
      if (answer.status === 404) return "missing";
      return answer.status === 200 ? sessionOf(answer.body) : null;
    },
    /** The QR to read, as a PNG data address; null while there is none (starting, linked, or already read). */
    async qr(sessionId: string): Promise<string | null> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}/qr`, { method: "GET" });
      const qr = (answer?.body as { qrCode?: unknown } | null)?.qrCode;
      return answer?.status === 200 && typeof qr === "string" && qr.startsWith("data:image/png;base64,") ? qr : null;
    },
    /** The session's webhook to ONE, signed with the platform's secret (at least 16 characters). */
    async webhook(sessionId: string, url: string, secret: string): Promise<boolean> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}/webhooks`, {
        method: "POST",
        body: { url, secret, events: OPENWA_EVENTS },
      });
      return Boolean(answer && answer.status >= 200 && answer.status < 300);
    },
    /** Unlinks the number from the phone and ends the session; false when it could not be confirmed. */
    async logout(sessionId: string): Promise<boolean> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}/logout`, { method: "POST" });
      return Boolean(answer && (answer.status < 300 || answer.status === 404));
    },
    async remove(sessionId: string): Promise<boolean> {
      const answer = await call(config, `sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
      return Boolean(answer && (answer.status < 300 || answer.status === 404));
    },
  };
}

/** The events ONE asks of a session: what people write, what the phone sends, what became of each message. */
export const OPENWA_EVENTS = ["message.received", "message.sent", "message.ack", "message.failed", "session.status"];

// ---------- What a delivery says ----------

/** Whether a delivery carries the HMAC of its raw body under the platform's secret (`X-OpenWA-Signature`). */
export function verifyOpenWaSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (typeof header !== "string" || !secret) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The kind of a message as WhatsApp Web names it, in the platform's words. */
export function openWaKind(type: unknown): InboundKind {
  switch (type) {
    case "chat":
    case "text":
    case "conversation":
      return "text";
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
    case "ptt":
      return "audio";
    case "document":
      return "document";
    case "sticker":
      return "sticker";
    case "location":
      return "location";
    case "vcard":
    case "multi_vcard":
      return "contacts";
    case "buttons_response":
    case "template_button_reply":
      return "button";
    case "list_response":
    case "interactive":
      return "interactive";
    case "call_log":
    case "call":
    case "e2e_notification":
    case "notification_template":
      return "system";
    default:
      return "unsupported";
  }
}

/** The digits of a person's chat (`5562...@c.us`, `...@s.whatsapp.net`), or null for a group, a status or a privacy id. */
export function phoneOfChat(chatId: unknown): string | null {
  if (typeof chatId !== "string") return null;
  const match = /^(\d{8,15})(?::\d+)?@(c\.us|s\.whatsapp\.net)$/.exec(chatId);
  return match ? match[1] : null;
}

const epochToDate = (value: unknown): Date | null =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? new Date(value * 1000) : null;

/**
 * A delivery of OpenWA read into the platform's events: one per delivery (`event`, `sessionId`, `data`). The
 * number of each event is the session (`phoneNumberId`). A group, a status, a broadcast, a channel and a person
 * known only by a privacy id with no phone (`@lid`, unless the gateway resolves it) are left out, as are the
 * session's own events (the screen asks the session how it is).
 */
export function parseOpenWaDelivery(raw: unknown): WhatsAppEvent[] {
  if (typeof raw !== "object" || raw === null) return [];
  const delivery = raw as { event?: unknown; sessionId?: unknown; data?: unknown };
  const sessionId = typeof delivery.sessionId === "string" ? delivery.sessionId : null;
  const data = (delivery.data ?? {}) as Record<string, unknown>;
  if (!sessionId) return [];
  const individual = (row: Record<string, unknown>) =>
    row.isGroup !== true && (row.kind === undefined || row.kind === "individual");

  if (delivery.event === "message.received" || delivery.event === "message.sent") {
    if (!individual(data)) return [];
    const id = typeof data.id === "string" && data.id ? data.id : null;
    if (!id) return [];
    const kind = openWaKind(data.type);
    const body = typeof data.body === "string" && data.body ? data.body.slice(0, 4096) : null;
    const chatId = typeof data.chatId === "string" ? data.chatId : null;
    const timestamp = epochToDate(data.timestamp);
    if (delivery.event === "message.sent" || data.fromMe === true) {
      const to = phoneOfChat(data.to) ?? phoneOfChat(chatId);
      if (!to) return [];
      return [{ type: "echo", phoneNumberId: sessionId, to, providerMessageId: id, kind, body, timestamp }];
    }
    const sender =
      typeof data.senderPhone === "string" && /^\d{8,15}$/.test(data.senderPhone) ? data.senderPhone : null;
    const from = phoneOfChat(data.from) ?? sender;
    if (!from) return [];
    const contact = (data.contact ?? {}) as Record<string, unknown>;
    const name =
      typeof contact.pushName === "string" && contact.pushName.trim()
        ? contact.pushName.trim()
        : typeof contact.name === "string" && contact.name.trim()
          ? contact.name.trim()
          : null;
    const media = (data.media ?? null) as Record<string, unknown> | null;
    const hasMedia = media !== null || data.hasMedia === true;
    return [
      {
        type: "message",
        phoneNumberId: sessionId,
        from,
        contactName: name ? name.slice(0, 120) : null,
        providerMessageId: id,
        kind,
        body,
        media:
          hasMedia && chatId
            ? {
                id: `${chatId}|${id}`,
                mimeType: typeof media?.mimetype === "string" ? media.mimetype : null,
                filename: typeof media?.filename === "string" ? media.filename : null,
              }
            : null,
        replyTo: null,
        timestamp,
      },
    ];
  }

  if (delivery.event === "message.ack" || delivery.event === "message.failed") {
    const messageId =
      typeof data.messageId === "string" && data.messageId
        ? data.messageId
        : typeof data.id === "string"
          ? data.id
          : null;
    const status = delivery.event === "message.failed" ? "failed" : data.status;
    if (!messageId || (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed"))
      return [];
    return [
      {
        type: "status",
        phoneNumberId: sessionId,
        providerMessageId: messageId,
        status,
        errorCode: status === "failed" ? "openwa_failed" : null,
        pricingCategory: null,
        pricingType: null,
      },
    ];
  }

  return [];
}
