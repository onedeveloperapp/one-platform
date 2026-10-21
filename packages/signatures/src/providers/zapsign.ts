import { createHash, timingSafeEqual } from "node:crypto";

import {
  type CreateEnvelopeInput,
  type Envelope,
  EnvelopeNotSignedError,
  type EnvelopeStatus,
  type SignatureProvider,
  type SignedDocument,
} from "@flyee/signatures/types";

/**
 * ZapSign, the provider a firm connects with its own API token (sealed in
 * ONE's vault, migration 0017). Read in ZapSign's API reference on 2026-10-09
 * (docs.zapsign.com.br, "Create document via Upload", "Detail document",
 * "Webhooks"):
 *
 *   POST {base}/api/v1/docs/          a document from a base64 PDF, with its
 *                                     signers; answers `token` (the
 *                                     document), `status` and one `token` and
 *                                     `sign_url` per signer;
 *   GET  {base}/api/v1/docs/{token}/  the document as it stands: `status`
 *                                     (`pending`, `signed`; `recusado` once
 *                                     refused), the signers with `signed_at`,
 *                                     and `signed_file`, a link that lasts 60
 *                                     minutes;
 *   POST {base}/api/v1/refuse/        cancels a document in progress (its
 *                                     signing addresses stop working);
 *   POST {base}/api/v1/user/company/webhook/         one webhook for the
 *                                     account (`type: ""` is every document event);
 *   POST {base}/api/v1/user/company/webhook/header/  the headers ZapSign
 *                                     sends with it;
 *   DELETE {base}/api/v1/user/company/webhook/delete/ removes a webhook.
 *
 * Authentication is `Authorization: Bearer <api token>`, and ZapSign asks
 * for a `User-Agent`. The sandbox
 * (sandbox.api.zapsign.com.br) answers the same and signs nothing with legal
 * validity. ZapSign does not sign the body of a webhook: what authenticates a
 * delivery is a header ONE asks ZapSign to send, with a secret only ONE and
 * that account know (`readZapSignWebhook`). A delivery only says something
 * happened: the state is always read again from the API.
 */

export type ZapSignEnvironment = "production" | "sandbox";

const API: Record<ZapSignEnvironment, string> = {
  production: "https://api.zapsign.com.br",
  sandbox: "https://sandbox.api.zapsign.com.br",
};

const APP: Record<ZapSignEnvironment, string> = {
  production: "https://app.zapsign.com.br",
  sandbox: "https://sandbox.app.zapsign.com.br",
};

/** The header ZapSign sends with each delivery, carrying the secret of the connection. */
export const ZAPSIGN_WEBHOOK_HEADER = "x-one-webhook-secret";

export type ZapSignOptions = {
  apiToken: string;
  environment: ZapSignEnvironment;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

/** ZapSign refused the token: the firm reconnects. Never carries the token. */
export class ZapSignAuthError extends Error {
  constructor() {
    super("zapsign refused the api token");
    this.name = "ZapSignAuthError";
  }
}

/** ZapSign answered something ONE cannot use. Carries the status, never the body. */
export class ZapSignUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? "zapsign did not answer" : `zapsign answered ${status}`);
    this.name = "ZapSignUnavailableError";
    this.status = status;
  }
}

type ZapSignSigner = {
  token?: string;
  name?: string;
  status?: string;
  sign_url?: string;
  signed_at?: string | null;
};

type ZapSignDocument = {
  token?: string;
  external_id?: string | null;
  status?: string;
  deleted?: boolean;
  signed_file?: string | null;
  date_limit_to_sign?: string | null;
  expiration_date?: string | null;
  signers?: ZapSignSigner[];
};

/** A document's token, as ZapSign makes them: nothing else ever reaches a path. */
const isDocumentToken = (value: string): boolean => /^[A-Za-z0-9-]{8,80}$/.test(value);

/** A phone as the signer's fields take it: Brazil's country code apart, the rest as digits. */
function phoneFields(phone: string | undefined): { phone_country: string; phone_number: string } {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return { phone_country: "", phone_number: "" };
  const brazil = /^55(\d{10,11})$/.exec(digits);
  return brazil ? { phone_country: "55", phone_number: brazil[1] } : { phone_country: "", phone_number: digits };
}

export class ZapSignProvider implements SignatureProvider {
  readonly name = "zapsign";

  private readonly options: Required<Omit<ZapSignOptions, "fetch">> & { fetch: typeof fetch };

  constructor(options: ZapSignOptions) {
    if (!options.apiToken.trim()) throw new ZapSignAuthError();
    this.options = {
      apiToken: options.apiToken.trim(),
      environment: options.environment,
      fetch: options.fetch ?? fetch,
      timeoutMs: options.timeoutMs ?? 20_000,
      now: options.now ?? Date.now,
    };
  }

  async createEnvelope(input: CreateEnvelopeInput): Promise<Envelope> {
    if (input.signers.length === 0) throw new Error("an envelope needs at least one signer");
    const document = await this.call<ZapSignDocument>("POST", "/api/v1/docs/", {
      name: input.title.slice(0, 255),
      base64_pdf: Buffer.from(input.pdf).toString("base64"),
      external_id: input.externalId,
      lang: "pt-br",
      // ONE sends the link itself (the client's page, the conversation): ZapSign writes to nobody.
      disable_signer_emails: true,
      allow_refuse_signature: true,
      signers: input.signers.map((signer) => ({
        name: signer.name,
        email: signer.email ?? "",
        ...phoneFields(signer.phone),
        auth_mode: "assinaturaTela",
        send_automatic_email: false,
        send_automatic_whatsapp: false,
        lock_name: true,
      })),
    });
    if (!document || !document.token) throw new ZapSignUnavailableError(null);
    return this.toEnvelope(document, input.externalId);
  }

  async getStatus(envelopeId: string): Promise<Envelope | null> {
    if (!isDocumentToken(envelopeId)) return null;
    const document = await this.call<ZapSignDocument>("GET", `/api/v1/docs/${envelopeId}/`);
    return document ? this.toEnvelope(document, document.external_id ?? "") : null;
  }

  async downloadSigned(envelopeId: string): Promise<SignedDocument> {
    if (!isDocumentToken(envelopeId)) throw new EnvelopeNotSignedError(envelopeId, "unknown");
    const document = await this.call<ZapSignDocument>("GET", `/api/v1/docs/${envelopeId}/`);
    if (!document) throw new EnvelopeNotSignedError(envelopeId, "unknown");
    const envelope = this.toEnvelope(document, document.external_id ?? "");
    if (envelope.status !== "signed") throw new EnvelopeNotSignedError(envelopeId, envelope.status);
    const link = String(document.signed_file ?? "");
    // The signed file is a temporary link ZapSign hands out: only over HTTPS.
    if (!link.startsWith("https://")) throw new ZapSignUnavailableError(null);
    const response = await this.fetchWithTimeout(link, { method: "GET" });
    if (!response.ok) throw new ZapSignUnavailableError(response.status);
    const pdf = new Uint8Array(await response.arrayBuffer());
    return {
      pdf,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      evidence: envelope.signers.map((signer) => ({ signerName: signer.name, signedAt: signer.signedAt ?? "" })),
    };
  }

  /**
   * Cancels a document still waiting for signatures: its signing addresses
   * stop working. A document already signed is not cancelled.
   */
  async cancelDocument(
    envelopeId: string,
    reason: string,
  ): Promise<"cancelled" | "already_ended" | "already_signed" | "not_found"> {
    if (!isDocumentToken(envelopeId)) return "not_found";
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${API[this.options.environment]}/api/v1/refuse/`, {
        method: "POST",
        headers: this.headers(true),
        body: JSON.stringify({
          doc_token: envelopeId,
          rejected_reason: reason.slice(0, 500) || "Cancelado pelo escritório",
        }),
      });
    } catch {
      throw new ZapSignUnavailableError(null);
    }
    if (response.ok) return "cancelled";
    if (response.status === 404) return "not_found";
    // ZapSign answers 403 both for a token it refuses and for a document it will not cancel: the body tells them apart.
    const text = response.status === 403 ? await response.text().catch(() => "") : "";
    if (text.includes("document_already_signed")) return "already_signed";
    if (text.includes("document_already_refused") || text.includes("refuse_not_allowed")) return "already_ended";
    if (response.status === 401 || response.status === 403) throw new ZapSignAuthError();
    throw new ZapSignUnavailableError(response.status);
  }

  /** Removes a webhook ONE registered (when the firm disconnects or reconnects the account). */
  async deleteWebhook(webhookId: string): Promise<void> {
    await this.call("DELETE", "/api/v1/user/company/webhook/delete/", { id: webhookId });
  }

  /**
   * Points the account's webhook at ONE, with the header that carries the
   * connection's secret. Answers the webhook's id at ZapSign.
   */
  async registerWebhook(input: { url: string; secret: string }): Promise<string> {
    const created = await this.call<{ id?: number | string }>("POST", "/api/v1/user/company/webhook/", {
      url: input.url,
      type: "",
    });
    if (created?.id === undefined || created.id === null) throw new ZapSignUnavailableError(null);
    await this.call("POST", "/api/v1/user/company/webhook/header/", {
      id: created.id,
      headers: [{ name: ZAPSIGN_WEBHOOK_HEADER, value: input.secret }],
    });
    return String(created.id);
  }

  private toEnvelope(document: ZapSignDocument, externalId: string): Envelope {
    const token = String(document.token ?? "");
    const signers = (document.signers ?? []).map((signer) => ({
      name: String(signer.name ?? ""),
      signUrl: signer.sign_url || `${APP[this.options.environment]}/verificar/${signer.token ?? ""}`,
      signedAt: signer.signed_at ?? null,
    }));
    return { id: token, externalId, status: this.statusOf(document), signers };
  }

  private statusOf(document: ZapSignDocument): EnvelopeStatus {
    const status = String(document.status ?? "").toLowerCase();
    if (status === "signed") return "signed";
    if (status === "recusado" || status === "refused" || status === "rejected" || document.deleted) return "refused";
    const deadline = Date.parse(String(document.expiration_date ?? document.date_limit_to_sign ?? ""));
    if (Number.isFinite(deadline) && deadline < this.options.now()) return "expired";
    return "pending";
  }

  private headers(json: boolean): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.apiToken}`,
      Accept: "application/json",
      "User-Agent": "ONE",
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  /**
   * One call to the API. Null on 404; throws on a refused token or on
   * anything else ONE cannot use. A success whose body cannot be read is an
   * answer nobody can tell (status null): ZapSign may have done it.
   */
  private async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T | null> {
    let response: Response;
    try {
      response = await this.fetchWithTimeout(`${API[this.options.environment]}${path}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ZapSignUnavailableError(null);
    }
    if (response.status === 404) return null;
    if (response.status === 401 || response.status === 403) throw new ZapSignAuthError();
    if (!response.ok) throw new ZapSignUnavailableError(response.status);
    const text = await response.text().catch(() => null);
    if (text === null) throw new ZapSignUnavailableError(null);
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ZapSignUnavailableError(null);
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return this.options.fetch(url, { ...init, signal: AbortSignal.timeout(this.options.timeoutMs) });
  }
}

/** What a webhook delivery says, once its header proved who sent it. */
export type ZapSignWebhookEvent = {
  /** `doc_signed` (a signer signed; the document may still be pending), `doc_refused`, `doc_expired`, `doc_deleted`, `doc_created`. */
  type: string;
  /** ZapSign's document token: the envelope's id. */
  documentToken: string;
  /** ONE's own reference, given when the envelope was made. */
  externalId: string;
  sandbox: boolean;
};

/** The SHA-256 of a webhook's secret, in hex: what ONE keeps beside the connection to check a delivery without opening the vault. */
export const webhookSecretHash = (secret: string): string => createHash("sha256").update(secret, "utf8").digest("hex");

/**
 * Reads a delivery: null unless the header carries the connection's secret
 * (its hash compared in constant time with the one kept for the connection)
 * and the body is an event about a document. The caller finds the connection
 * by the envelope the event names; a delivery never decides a state by itself.
 */
export function readZapSignWebhook(input: {
  header: string | null | undefined;
  secretSha256: string | null | undefined;
  body: string;
}): ZapSignWebhookEvent | null {
  if (!input.header || !/^[0-9a-f]{64}$/.test(input.secretSha256 ?? "")) return null;
  const received = Buffer.from(webhookSecretHash(input.header), "hex");
  if (!timingSafeEqual(received, Buffer.from(String(input.secretSha256), "hex"))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const event = parsed as Record<string, unknown>;
  const type = typeof event.event_type === "string" ? event.event_type : "";
  const token = typeof event.token === "string" ? event.token : "";
  if (!/^doc_[a-z_]+$/.test(type) || !isDocumentToken(token)) return null;
  return {
    type,
    documentToken: token,
    externalId: typeof event.external_id === "string" ? event.external_id : "",
    sandbox: event.sandbox === true,
  };
}

/** The external id a delivery names, before any secret is known: how the caller finds the connection. */
export function zapSignExternalId(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return typeof parsed.external_id === "string" && parsed.external_id ? parsed.external_id : null;
  } catch {
    return null;
  }
}
