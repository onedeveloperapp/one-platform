import { createHash } from "node:crypto";

import {
  type AccountSignatureProvider,
  type CancelAnswer,
  type CreateEnvelopeInput,
  type Envelope,
  EnvelopeNotSignedError,
  type EnvelopeStatus,
  SignatureAuthError,
  type SignedDocument,
  SignatureUnavailableError,
} from "@flyee/signatures/types";

/**
 * D4Sign, a provider a firm connects with its own account (migration 0253): the two keys of its API, sealed in ONE's
 * vault, and the safe ("cofre") its clients' papers go into. Read in D4Sign's API reference (docapi.d4sign.com.br, its
 * Markdown and OpenAPI pages, the public Postman collection and the official PHP SDK) on 2026-11-17:
 *
 *   GET  {base}/safes                                  the account's safes, `[{"uuid-safe","name-safe"}]`;
 *   POST {base}/documents/{safe}/uploadbinary          a document from a base64 PDF, answers `{"uuid"}`;
 *   POST {base}/documents/{uuid}/webhooks              where D4Sign posts what happens to that document;
 *   POST {base}/documents/{uuid}/createlist            the signers, each answered with its `key_signer`;
 *   POST {base}/documents/{uuid}/sendtosigner          to signature, `skip_email` "1" (ONE sends the address);
 *   GET  {base}/documents/{uuid}/signaturelink/{id}    a signer's own address, `id` the decoded `key_signer`;
 *   GET  {base}/documents/{uuid}/list                  the document's phase (`statusId`) and each signer's
 *                                                      `signed` and `sign_info.date_signed_atom`;
 *   POST {base}/documents/{uuid}/download              a temporary address of the signed PDF (about 4 hours);
 *   POST {base}/documents/{uuid}/cancel                ends a document still waiting (phases 2 and 3).
 *
 * The keys go in the address of every call (`tokenAPI`, and `cryptKey` only where the account enabled it), and
 * `tokenAPI` in a header too, as D4Sign's examples do: an address of a call is never logged. Production answers at
 * secure.d4sign.com.br, the sandbox, an account of its own, at sandbox.d4sign.com.br, with no legal validity.
 *
 * What D4Sign says that shapes this file: the API allows 10 calls an hour by default (more if its sales raise it),
 * so a document costs four calls and one per signer, its webhook tells what happens and the sweep asks rarely; every
 * signer is an e-mail address, to which D4Sign sends a token at the moment of signing even when the address comes by
 * another channel ("essa camada de segurança não pode ser removida"), so a signer with no e-mail is not sent; the
 * webhook comes as form data and is authenticated here by the secret ONE writes in its own address, since D4Sign's
 * HMAC takes a third key of the account and its pages disagree on what it covers; what a delivery says is never the
 * state: the document is read again. None of it ran against D4Sign yet: the provider is proven with a stand-in in
 * the shapes of the reference, and the pilot's sandbox account is where it is checked (`README.md`).
 */

export type D4SignEnvironment = "production" | "sandbox";

const API: Record<D4SignEnvironment, string> = {
  production: "https://secure.d4sign.com.br/api/v1",
  sandbox: "https://sandbox.d4sign.com.br/api/v1",
};

export type D4SignOptions = {
  tokenApi: string;
  /** Only where the account enabled it; an empty one is not sent. */
  cryptKey?: string | null;
  environment: D4SignEnvironment;
  /** The safe the papers go into. Needed to open an envelope; listing the safes does without it. */
  safeUuid?: string | null;
  /** The address D4Sign posts a document's events to, made for ONE's envelope. None: no webhook (the sweep asks). */
  webhookFor?: (externalId: string) => string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** D4Sign refused the keys: the firm reconnects. Never carries a key. */
export class D4SignAuthError extends SignatureAuthError {
  constructor() {
    super("d4sign refused the api keys");
    this.name = "D4SignAuthError";
  }
}

/** D4Sign answered something ONE cannot use, or did not answer. Carries the status and a short code, never the body. */
export class D4SignUnavailableError extends SignatureUnavailableError {
  constructor(status: number | null, code?: string) {
    super(status, status === null ? "d4sign did not answer" : `d4sign answered ${status}`, code);
    this.name = "D4SignUnavailableError";
  }
}

/** A document's id at D4Sign (a UUID): nothing else ever reaches a path. */
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** A signer's `key_signer`: base64 text. The signing address wants it decoded (`NDcwMzE2Nw==` is `4703167`). */
function linkIdOf(keySigner: string): string | null {
  if (!/^[A-Za-z0-9+/=]{2,200}$/.test(keySigner)) return null;
  const decoded = Buffer.from(keySigner, "base64").toString("utf8");
  return /^[A-Za-z0-9_-]{1,100}$/.test(decoded) ? decoded : null;
}

type D4SignSigner = {
  key_signer?: unknown;
  email?: unknown;
  user_name?: unknown;
  signed?: unknown;
  sign_info?: { date_signed_atom?: unknown; date_signed?: unknown } | null;
  date?: unknown;
};

type D4SignListed = {
  uuidDoc?: unknown;
  statusId?: unknown;
  statusComment?: unknown;
  list?: D4SignSigner | D4SignSigner[] | null;
};

/** One object or a list of them, as D4Sign's examples show one and a document has several. */
const many = <T>(value: T | T[] | null | undefined): T[] => (Array.isArray(value) ? value : value ? [value] : []);

/** The registration order of a signer: its decoded `key_signer` is a number that grows. */
const orderOf = (signer: D4SignSigner): number => {
  const id = typeof signer.key_signer === "string" ? linkIdOf(signer.key_signer) : null;
  return id && /^\d+$/.test(id) ? Number(id) : Number.MAX_SAFE_INTEGER;
};

export class D4SignProvider implements AccountSignatureProvider {
  readonly name = "d4sign";

  private readonly options: {
    tokenApi: string;
    cryptKey: string | null;
    environment: D4SignEnvironment;
    safeUuid: string | null;
    webhookFor: ((externalId: string) => string) | null;
    fetch: typeof fetch;
    timeoutMs: number;
  };

  constructor(options: D4SignOptions) {
    if (!options.tokenApi.trim()) throw new D4SignAuthError();
    this.options = {
      tokenApi: options.tokenApi.trim(),
      cryptKey: options.cryptKey?.trim() || null,
      environment: options.environment,
      safeUuid: options.safeUuid ?? null,
      webhookFor: options.webhookFor ?? null,
      fetch: options.fetch ?? fetch,
      timeoutMs: options.timeoutMs ?? 20_000,
    };
  }

  /** The account's safes, by name: what the firm chooses its papers' safe from when it connects. */
  async listSafes(): Promise<{ uuid: string; name: string }[]> {
    const safes = await this.call<unknown>("GET", "/safes");
    return many(safes as Record<string, unknown> | Record<string, unknown>[] | null).flatMap((safe) => {
      const uuid = safe["uuid-safe"] ?? safe.uuid_safe;
      const name = safe["name-safe"] ?? safe.name_safe;
      return isUuid(uuid) ? [{ uuid, name: typeof name === "string" && name.trim() ? name.trim() : uuid }] : [];
    });
  }

  /**
   * Uploads the PDF to the firm's safe, points its webhook at ONE, names its signers by their e-mail, sends it to
   * signature with no e-mail of D4Sign's and reads each signer's own address. A document left half made by a refusal
   * or a failure along the way is cancelled at D4Sign before the error goes on, so nothing waits there for nobody.
   */
  async createEnvelope(input: CreateEnvelopeInput): Promise<Envelope> {
    if (input.signers.length === 0) throw new Error("an envelope needs at least one signer");
    if (!isUuid(this.options.safeUuid)) throw new D4SignUnavailableError(null, "no_safe");
    const emails = input.signers.map((signer) =>
      String(signer.email ?? "")
        .trim()
        .toLowerCase(),
    );
    if (emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      throw new D4SignUnavailableError(422, "signer_email_missing");
    }
    // Two signers on one address would get one code and one address to sign (0254): refused before anything leaves.
    if (new Set(emails).size !== emails.length) throw new D4SignUnavailableError(422, "signer_email_shared");
    const uploaded = await this.call<{ uuid?: unknown }>("POST", `/documents/${this.options.safeUuid}/uploadbinary`, {
      base64_binary_file: Buffer.from(input.pdf).toString("base64"),
      mime_type: "application/pdf",
      name: input.title.slice(0, 200),
    });
    // A safe D4Sign does not know (deleted, or no longer the API user's): nothing was made, and the firm reconnects.
    if (uploaded === null) throw new D4SignUnavailableError(404, "safe_not_found");
    const uuid = uploaded.uuid;
    if (!isUuid(uuid)) throw new D4SignUnavailableError(null);

    try {
      if (this.options.webhookFor) {
        // Without it the sweep asks: a webhook D4Sign would not take does not stop the paper.
        await this.call("POST", `/documents/${uuid}/webhooks`, {
          url: this.options.webhookFor(input.externalId),
        }).catch((thrown: unknown) => {
          // Refused keys and the hour's limit end the opening; any other refusal of the webhook does not.
          if (thrown instanceof SignatureAuthError) throw thrown;
          if (thrown instanceof SignatureUnavailableError && thrown.code === "provider_rate_limited") throw thrown;
        });
      }
      const listed = await this.call<unknown>("POST", `/documents/${uuid}/createlist`, {
        signers: emails.map((email) => ({
          email,
          act: "1",
          foreign: "0",
          certificadoicpbr: "0",
          assinatura_presencial: "0",
          // ONE sends the address itself (the client's page, the conversation): D4Sign writes only the token.
          skipemail: "1",
        })),
      });
      const keys = this.keysOf(listed, emails);
      await this.call("POST", `/documents/${uuid}/sendtosigner`, {
        skip_email: "1",
        workflow: "0",
        tokenAPI: this.options.tokenApi,
      });
      const signers = [];
      for (const [index, signer] of input.signers.entries()) {
        const id = linkIdOf(keys[index]);
        if (!id) throw new D4SignUnavailableError(null);
        const answer = await this.call<{ link?: unknown }>("GET", `/documents/${uuid}/signaturelink/${id}`);
        const link = typeof answer?.link === "string" ? answer.link : "";
        if (!link.startsWith("https://")) throw new D4SignUnavailableError(null);
        signers.push({ name: signer.name, signUrl: link, signedAt: null });
      }
      return { id: uuid, externalId: input.externalId, status: "pending", signers };
    } catch (thrown) {
      await this.cancelQuietly(uuid);
      throw thrown;
    }
  }

  async getStatus(envelopeId: string): Promise<Envelope | null> {
    if (!isUuid(envelopeId)) return null;
    const listed = await this.call<unknown>("GET", `/documents/${envelopeId}/list`);
    const document = many(listed as D4SignListed | D4SignListed[] | null).find(
      (item) => typeof item === "object" && item !== null && ("statusId" in item || "list" in item),
    );
    if (!document) return null;
    const signers = many(document.list)
      .filter((signer) => typeof signer === "object" && signer !== null)
      .sort((a, b) => orderOf(a) - orderOf(b))
      .map((signer) => ({
        name: typeof signer.user_name === "string" ? signer.user_name : "",
        // A status read keeps no address: D4Sign gives one per call, and opening an envelope is what fetched them.
        signUrl: "",
        signedAt: String(signer.signed ?? "") === "1" ? this.signedAtOf(signer) : null,
      }));
    return { id: envelopeId, externalId: "", status: this.statusOf(document, signers), signers };
  }

  /** The signed PDF. A state the caller just read is taken as it is: D4Sign's calls are few (0254). */
  async downloadSigned(envelopeId: string, known?: Envelope | null): Promise<SignedDocument> {
    const envelope = known && known.id === envelopeId ? known : await this.getStatus(envelopeId);
    if (!envelope) throw new EnvelopeNotSignedError(envelopeId, "unknown");
    if (envelope.status !== "signed") throw new EnvelopeNotSignedError(envelopeId, envelope.status);
    const answer = await this.call<{ url?: unknown }>("POST", `/documents/${envelopeId}/download`, {
      type: "pdf",
      language: "pt",
    });
    const url = typeof answer?.url === "string" ? answer.url : "";
    // A temporary address D4Sign hands out: only over HTTPS, and fetched with no key.
    if (!url.startsWith("https://")) throw new D4SignUnavailableError(null);
    let response: Response;
    try {
      response = await this.options.fetch(url, { method: "GET", signal: AbortSignal.timeout(this.options.timeoutMs) });
    } catch {
      throw new D4SignUnavailableError(null);
    }
    if (!response.ok) throw new D4SignUnavailableError(response.status);
    const pdf = new Uint8Array(await response.arrayBuffer());
    // A PDF begins with "%PDF": anything else (a page of an error, a zip) is not the signed document.
    if (pdf.length < 5 || Buffer.from(pdf.subarray(0, 4)).toString("latin1") !== "%PDF") {
      throw new D4SignUnavailableError(null);
    }
    return {
      pdf,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      evidence: envelope.signers.map((signer) => ({ signerName: signer.name, signedAt: signer.signedAt ?? "" })),
    };
  }

  /** Cancels a document still waiting for signatures: its signing addresses stop working. */
  async cancelDocument(envelopeId: string, reason: string): Promise<CancelAnswer> {
    if (!isUuid(envelopeId)) return "not_found";
    const envelope = await this.getStatus(envelopeId);
    if (!envelope) return "not_found";
    if (envelope.status === "signed") return "already_signed";
    if (envelope.status !== "pending") return "already_ended";
    await this.call("POST", `/documents/${envelopeId}/cancel`, {
      comment: reason.slice(0, 500) || "Cancelado pelo escritório",
    });
    return "cancelled";
  }

  private async cancelQuietly(uuid: string): Promise<void> {
    await this.call("POST", `/documents/${uuid}/cancel`, {
      comment: "Documento incompleto, refeito pelo escritório",
    }).catch(() => undefined);
  }

  /** Each signer's `key_signer`, in the order the e-mails were given (D4Sign answers one object or a list). */
  private keysOf(listed: unknown, emails: string[]): string[] {
    const answer = listed as { message?: unknown } | unknown[] | null;
    const entries = many(
      (Array.isArray(answer) ? answer : ((answer as { message?: unknown } | null)?.message ?? answer)) as
        | D4SignSigner
        | D4SignSigner[]
        | null,
    ).filter((entry) => typeof entry === "object" && entry !== null && typeof entry.key_signer === "string");
    const keys = emails.map((email, index) => {
      const byEmail = entries.find(
        (entry) =>
          String(entry.email ?? "")
            .trim()
            .toLowerCase() === email,
      );
      return String((byEmail ?? entries[index])?.key_signer ?? "");
    });
    if (keys.some((key) => !key)) throw new D4SignUnavailableError(null);
    return keys;
  }

  private signedAtOf(signer: D4SignSigner): string {
    const atom = signer.sign_info?.date_signed_atom;
    if (typeof atom === "string" && Number.isFinite(Date.parse(atom))) return new Date(Date.parse(atom)).toISOString();
    // "2038-03-29 11:05:34" is the account's time, Brasília's: written with its offset.
    const local = signer.sign_info?.date_signed;
    if (typeof local === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(local)) {
      return new Date(`${local.replace(" ", "T")}-03:00`).toISOString();
    }
    return new Date(0).toISOString();
  }

  /**
   * The document's phase as ONE reads an envelope: 4 Finalizado is signed (5 Arquivado, a signed document kept five
   * years, too); 6 Cancelado never becomes signed (cancelled by the firm, by a signer's refusal or by a date), so a
   * new envelope is made; 1 Processando, 2 Aguardando Signatários, 3 Aguardando Assinaturas and 7 Editando wait.
   */
  private statusOf(document: D4SignListed, signers: { signedAt: string | null }[]): EnvelopeStatus {
    const phase = String(document.statusId ?? "");
    if (phase === "4" || phase === "5") return "signed";
    if (phase === "6") return "refused";
    if (signers.length > 0 && signers.every((signer) => signer.signedAt) && phase === "") return "signed";
    return "pending";
  }

  private headers(json: boolean): Record<string, string> {
    return {
      Accept: "application/json",
      tokenAPI: this.options.tokenApi,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  /**
   * One call to the API. Null on 404; throws on refused keys or anything ONE cannot use. A success whose body cannot
   * be read is an answer nobody can tell (status null): D4Sign may have done it. D4Sign's limit of calls an hour and
   * its refusal of the keys are said by a status (429, 401) or by its words, read only in a refusal or in a success
   * that is nothing but a message (0254): the words of a document, a safe or a signer's comment are never taken for
   * them. A 403 is a refused access (a safe or a document the API user may not reach), not the keys' end.
   */
  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T | null> {
    const query = new URLSearchParams({ tokenAPI: this.options.tokenApi });
    if (this.options.cryptKey) query.set("cryptKey", this.options.cryptKey);
    let response: Response;
    try {
      response = await this.options.fetch(`${API[this.options.environment]}${path}?${query}`, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new D4SignUnavailableError(null);
    }
    const text = await response.text().catch(() => null);
    const said = response.ok ? messageOnly(text) : text;
    if (response.status === 429 || (said !== null && RATE_LIMIT_WORDS.test(said))) {
      throw new D4SignUnavailableError(429, "provider_rate_limited");
    }
    if (response.status === 401 || (said !== null && /check api user/i.test(said))) throw new D4SignAuthError();
    if (response.status === 404) return null;
    if (response.status === 403) throw new D4SignUnavailableError(403, "provider_forbidden");
    if (!response.ok) throw new D4SignUnavailableError(response.status);
    if (text === null) throw new D4SignUnavailableError(null);
    if (!text.trim()) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new D4SignUnavailableError(null);
    }
  }
}

/** How D4Sign says its limit of calls an hour was reached, in its words (the exact answer is not in its reference). */
const RATE_LIMIT_WORDS = /tempo limite|time limit|limite de requisi|too many requests/i;

/** The words of a success that is only a message (`{"message": "..."}`, `{"mensagem": "..."}`); null for anything else. */
function messageOnly(text: string | null): string | null {
  if (text === null || !text.trim().startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    const words = ["message", "mensagem", "error", "erro"];
    if (entries.length === 0 || entries.length > 2) return null;
    if (!entries.every(([key]) => words.includes(key.toLowerCase()) || key.toLowerCase() === "status")) return null;
    const message = entries.find(([key]) => words.includes(key.toLowerCase()))?.[1];
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

/** The address D4Sign posts a document's events to: ONE's envelope and the secret of the firm's connection. */
export function d4signWebhookUrl(siteUrl: string, envelopeId: string, secret: string): string {
  const query = new URLSearchParams({ envelope: envelopeId, key: secret });
  return `${siteUrl.replace(/\/+$/, "")}/api/webhooks/d4sign?${query}`;
}

/** What a delivery says, read from the form D4Sign posts: the document and what happened to it (`type_post`). */
export type D4SignWebhookEvent = {
  /** D4Sign's document: the envelope's provider id. */
  documentUuid: string;
  /** "1" finished, "2" an e-mail not delivered, "3" cancelled, "4" one signer signed. */
  typePost: string;
};

/** Reads a delivery's fields, wherever D4Sign put them; null unless it names a document and an event. */
export function readD4SignWebhook(fields: Record<string, unknown>): D4SignWebhookEvent | null {
  const uuid = fields.uuid;
  const typePost = String(fields.type_post ?? "");
  if (!isUuid(uuid) || !/^[1-9]$/.test(typePost)) return null;
  return { documentUuid: uuid, typePost };
}
