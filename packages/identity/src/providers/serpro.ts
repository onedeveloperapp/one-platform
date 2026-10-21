import {
  type CpfLookup,
  type CpfLookupResult,
  normalizeBirthDate,
  normalizeCpf,
} from "@flyee/identity/types";

/**
 * The Serpro "Consulta CPF" API, version 3 (its reference, read on
 * 2026-10-09: the quick start, the return codes and the returned types):
 *
 *   POST https://gateway.apiserpro.serpro.gov.br/token
 *        Authorization: Basic base64(consumerKey:consumerSecret)
 *        grant_type=client_credentials        -> { access_token, expires_in }
 *   GET  https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/{cpf}/{DDMMAAAA}
 *        Authorization: Bearer <token>        -> { ni, nome, situacao: { codigo, descricao }, nascimento, ... }
 *
 * 200 and 206 answer the record (206: a field such as the date of
 * registration is missing); 404 is a CPF the registry does not have, or one
 * whose birth date differs; 422 and 451 are people under 18 and under 16, for
 * whom it does not answer; 401 is a token that ended (asked again once); 410
 * is a version taken down. Only 200, 206 and 404 are billed.
 *
 * The credential is the platform's, not a firm's: ONE contracts the registry,
 * and the database limits how many lookups each firm makes a day.
 */

const GATEWAY = "https://gateway.apiserpro.serpro.gov.br";

export type SerproConfig = {
  consumerKey: string;
  consumerSecret: string;
  /** `trial` answers for the fictitious CPFs of the reference, for free; `production` is billed. */
  environment: "production" | "trial";
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Injected in tests. */
  now?: () => number;
};

type Answer = { status: number; body: unknown } | null;

/** `14111970` as `1970-11-14`; null when it is not a day. */
const fromDdMmYyyy = (value: unknown): string | null => {
  const match = /^(\d{2})(\d{2})(\d{4})$/.exec(String(value ?? ""));
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

export class SerproCpfLookup implements CpfLookup {
  private readonly config: SerproConfig;
  private token: { value: string; until: number } | null = null;

  constructor(config: SerproConfig) {
    this.config = config;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async call(url: string, init: RequestInit): Promise<Answer> {
    const run = this.config.fetch ?? fetch;
    try {
      const response = await run(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000) });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    } catch {
      return null;
    }
  }

  /** The bearer token, asked again a minute before it ends, or when the gateway refused it. */
  private async bearer(force = false): Promise<string | null> {
    if (!force && this.token && this.token.until > this.now()) return this.token.value;
    const basic = Buffer.from(`${this.config.consumerKey}:${this.config.consumerSecret}`, "utf8").toString("base64");
    const answer = await this.call(`${GATEWAY}/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    const body = (answer?.body ?? null) as { access_token?: unknown; expires_in?: unknown } | null;
    const value = text(body?.access_token);
    if (!answer || answer.status !== 200 || !value) {
      this.token = null;
      return null;
    }
    const seconds = Number(body?.expires_in);
    const lifetime = Number.isFinite(seconds) && seconds > 120 ? seconds : 3600;
    this.token = { value, until: this.now() + (lifetime - 60) * 1000 };
    return value;
  }

  async lookupCpf(cpf: string, birthDate: string): Promise<CpfLookupResult> {
    const digits = normalizeCpf(cpf);
    const born = normalizeBirthDate(birthDate);
    const ddmmyyyy = `${born.slice(8, 10)}${born.slice(5, 7)}${born.slice(0, 4)}`;
    const base = this.config.environment === "trial" ? "consulta-cpf-df-trial" : "consulta-cpf-df";
    const url = `${GATEWAY}/${base}/v3/cpf/${digits}/${ddmmyyyy}`;

    let answer: Answer = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.bearer(attempt > 0);
      if (!token) return { kind: "unavailable", detail: "token_refused" };
      answer = await this.call(url, { method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
      // A token that ended before its time: asked again once.
      if (answer?.status !== 401) break;
    }
    if (!answer) return { kind: "unavailable", detail: "no_answer" };

    const body = (answer.body ?? {}) as Record<string, unknown>;
    if (answer.status === 200 || answer.status === 206) {
      const situation = (body.situacao ?? {}) as Record<string, unknown>;
      const code = text(situation.codigo) ?? String(situation.codigo ?? "");
      const name = text(body.nome);
      if (!name || code === "") return { kind: "unavailable", detail: "unreadable_answer" };
      return {
        kind: "found",
        partial: answer.status === 206,
        record: {
          cpf: text(body.ni) ?? digits,
          name,
          socialName: text(body.nomeSocial),
          birthDate: fromDdMmYyyy(body.nascimento) ?? born,
          situationCode: code,
          situation: text(situation.descricao) ?? code,
          regular: code === "0",
        },
      };
    }
    if (answer.status === 404) {
      return body.erro === "DATA_NASCIMENTO_DIVERGENTE" ? { kind: "birth_date_mismatch" } : { kind: "not_found" };
    }
    if (answer.status === 422 || answer.status === 451) return { kind: "minor" };
    if (answer.status === 400) {
      // The number and the date were checked before the call: the registry read them otherwise.
      return { kind: "unavailable", detail: text(body.erro)?.toLowerCase() ?? "invalid_request" };
    }
    if (answer.status === 401 || answer.status === 403) return { kind: "unavailable", detail: "credential_refused" };
    if (answer.status === 410) return { kind: "unavailable", detail: "version_retired" };
    return { kind: "unavailable", detail: `http_${answer.status}` };
  }
}
