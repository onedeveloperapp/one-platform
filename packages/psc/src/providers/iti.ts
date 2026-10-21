import { holderPemOf } from "@flyee/psc/certificate";
import {
  type AuthorizeRequest,
  type PscCertificate,
  PscError,
  type PscErrorCode,
  type PscProvider,
  type PscToken,
  SHA256_OID,
  type SignRequest,
  type SignResult,
  type TokenRequest,
} from "@flyee/psc/types";

/**
 * The client of a PSC as the ITI's DOC-ICP-17.01 (version 3.0, item 6.4;
 * read on 2026-10-14) specifies its API: one client for every accredited
 * PSC, configured by the PSC's base address (with its version path, as the
 * ITI's list of PSCs or the PSC's manual gives it) and by the few ways a PSC
 * departs from the norm on its own page:
 *
 *   - BirdID (Soluti) says its hashes go in hexadecimal; the norm says base64.
 *   - BirdID's page shows the token request in JSON; the norm, a form.
 *
 * What the norm leaves to each PSC (a push to the holder's phone, a PAdES
 * the PSC itself builds) is not used: the core is the same everywhere.
 * Nothing here ran against a PSC yet; the contract test answers in the
 * norm's shapes.
 */

export type ItiPscOptions = {
  /** The PSC's name in ONE ("birdid", "serproid"...). */
  name: string;
  /** The PSC's base address with its version path, e.g. https://api.birdid.com.br/v0. */
  baseUrl: string;
  /** How the PSC takes a hash: base64, as the norm says, or hexadecimal. */
  hashEncoding?: "base64" | "hex";
  /** How the token request's body goes: a form, as the norm says, or JSON. */
  tokenBody?: "form" | "json";
  fetch?: typeof fetch;
  /** How long a call waits for the PSC before it is given up as unavailable. */
  timeoutMs?: number;
};

type Json = Record<string, unknown>;

/**
 * The words a PSC answers an error with, read by what the caller does next.
 * Only the token endpoint speaks of the holder saying no: there, a refusal is
 * the holder's. On the endpoints a token reaches, a 401 is a token that no
 * longer works and any other refusal is of the request as it was (a hash, a
 * certificate), never the end of the lawyer's authorization.
 */
function errorCodeOf(status: number, body: Json, endpoint: "token" | "resource"): PscErrorCode {
  const words = [body.error, body.code, body.error_description, body.message]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (status >= 500 || status === 429) return "unavailable";
  // Only words about the token itself: an id or a hash said to be used already is a refusal of the request.
  if (
    /token_ja_utilizado|token_already_used|token (j[aá] )?(foi )?utilizado|token (has )?(already )?been used|token already used/.test(
      words,
    )
  ) {
    return "token_used";
  }
  if (endpoint === "token") {
    if (/access_denied|user_denied|negad|recusad/.test(words)) return "denied";
    if (/invalid_client|unauthorized_client|client_id|client_secret/.test(words)) return "not_authorized";
    // A code that lived its time, was spent or does not match its verifier: the holder authorizes again.
    if (status === 400 || status === 401) return "expired";
    return "refused";
  }
  if (status === 401) return "expired";
  return "refused";
}

/**
 * A certificate as PEM, whether the PSC wrapped it or sent the bare base64;
 * of a bundle, the holder's (the first that is no authority, whatever the
 * order the chain came in).
 */
function asPem(certificate: string): string {
  const text = certificate.trim();
  const holder = holderPemOf(text);
  if (holder) return holder;
  const lines = text.replace(/\s+/g, "").match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----`;
}

/**
 * The bytes of a signature: base64 as the norm says (RAW), a PEM block
 * (CMS), or hexadecimal, as a PSC that takes its hashes in hexadecimal may
 * answer (a signature in base64 made only of hexadecimal digits has a
 * vanishing chance).
 */
function signatureBytes(value: string, hexAllowed: boolean): Uint8Array {
  const body = value.replace(/-----(BEGIN|END)[^-]+-----/g, "").replace(/\s+/g, "");
  if (hexAllowed && body.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(body)) {
    return new Uint8Array(Buffer.from(body, "hex"));
  }
  return new Uint8Array(Buffer.from(body, "base64"));
}

export class ItiPscProvider implements PscProvider {
  readonly name: string;
  private readonly base: string;
  private readonly hashEncoding: "base64" | "hex";
  private readonly tokenBody: "form" | "json";
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: ItiPscOptions) {
    this.name = options.name;
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.hashEncoding = options.hashEncoding ?? "base64";
    this.tokenBody = options.tokenBody ?? "form";
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  authorizeUrl(request: AuthorizeRequest): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: request.clientId,
      redirect_uri: request.redirectUri,
      state: request.state,
      scope: request.scope,
      code_challenge: request.codeChallenge,
      code_challenge_method: "S256",
    });
    if (request.lifetimeSeconds !== undefined) params.set("lifetime", String(Math.floor(request.lifetimeSeconds)));
    if (request.loginHint) params.set("login_hint", request.loginHint.replace(/\D/g, ""));
    return `${this.base}/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(request: TokenRequest): Promise<PscToken> {
    const fields = {
      grant_type: "authorization_code",
      client_id: request.clientId,
      client_secret: request.clientSecret,
      code: request.code,
      redirect_uri: request.redirectUri,
      code_verifier: request.codeVerifier,
    };
    const body = this.tokenBody === "json" ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
    const answer = await this.call("token", `${this.base}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": this.tokenBody === "json" ? "application/json" : "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
    const token = answer.access_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new PscError("refused", `${this.name}: the token answer carries no access token`);
    }
    const expiresIn = Number(answer.expires_in);
    const scope = typeof answer.scope === "string" && answer.scope.trim() ? answer.scope.trim() : null;
    const type = answer.authorized_identification_type;
    const value = answer.authorized_identification;
    // A CPF or a CNPJ, as a text or a number (which loses the zeros in front of it): its digits, at full length.
    const digits = typeof value === "string" || typeof value === "number" ? String(value).replace(/\D/g, "") : "";
    return {
      accessToken: token,
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? Math.floor(expiresIn) : 0,
      scope,
      identification:
        (type === "CPF" || type === "CNPJ") && digits
          ? { type, value: digits.padStart(type === "CPF" ? 11 : 14, "0") }
          : null,
    };
  }

  async certificates(token: string): Promise<PscCertificate[]> {
    const answer = await this.call("resource", `${this.base}/oauth/certificate-discovery`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    // "N": the token reaches no certificate at this PSC. An answer of another shape is no answer to build on.
    if (answer.status === "N") return [];
    if (!Array.isArray(answer.certificates)) {
      throw new PscError("refused", `${this.name}: the certificate discovery answered no list`);
    }
    const list = answer.certificates;
    return list
      .filter((item): item is Json => typeof item === "object" && item !== null)
      .filter((item) => typeof item.certificate === "string")
      .map((item) => ({
        alias: typeof item.alias === "string" ? item.alias : "",
        pem: asPem(item.certificate as string),
      }));
  }

  async sign(request: SignRequest): Promise<SignResult> {
    if (request.hashes.length === 0) return { certificateAlias: request.certificateAlias ?? "", signatures: [] };
    for (const item of request.hashes) {
      if (item.hash.length !== 32) {
        throw new PscError("refused", `${this.name}: hash ${item.id} is not a SHA-256 of 32 bytes`);
      }
    }
    const answer = await this.call("resource", `${this.base}/oauth/signature`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        ...(request.certificateAlias ? { certificate_alias: request.certificateAlias } : {}),
        hashes: request.hashes.map((item) => ({
          id: item.id,
          alias: item.id,
          hash: Buffer.from(item.hash).toString(this.hashEncoding),
          hash_algorithm: SHA256_OID,
          signature_format: request.format,
        })),
      }),
    });
    if (answer.status === "N") throw new PscError("refused", `${this.name}: the PSC answered status N`);
    const list = Array.isArray(answer.signatures) ? answer.signatures : [];
    const signatures = list
      .filter((item): item is Json => typeof item === "object" && item !== null)
      .filter(
        (item) =>
          (typeof item.id === "string" || typeof item.id === "number") && typeof item.raw_signature === "string",
      )
      .map((item) => ({
        id: String(item.id),
        value: signatureBytes(item.raw_signature as string, this.hashEncoding === "hex"),
      }));
    // Every hash asked has its signature, or the answer is not one to build anything on.
    const missing = request.hashes.filter((item) => !signatures.some((signature) => signature.id === item.id));
    if (missing.length > 0) {
      throw new PscError(
        "refused",
        `${this.name}: no signature came back for ${missing.map((item) => item.id).join(", ")}`,
      );
    }
    return {
      certificateAlias:
        typeof answer.certificate_alias === "string" ? answer.certificate_alias : (request.certificateAlias ?? ""),
      signatures,
    };
  }

  private async call(endpoint: "token" | "resource", url: string, init: RequestInit): Promise<Json> {
    let response: Response;
    try {
      response = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new PscError("unavailable", `${this.name}: ${(error as Error).message}`);
    }
    let body: Json = {};
    try {
      const text = await response.text();
      body = text.trim().startsWith("{") ? (JSON.parse(text) as Json) : { message: text.slice(0, 200) };
    } catch {
      body = {};
    }
    if (!response.ok) {
      throw new PscError(errorCodeOf(response.status, body, endpoint), `${this.name}: HTTP ${response.status}`);
    }
    return body;
  }
}
