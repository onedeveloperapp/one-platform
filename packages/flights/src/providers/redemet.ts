import type { Metar, WeatherProvider } from "@flyee/flights/types";

/**
 * The weather observed at Brazilian airports, from REDEMET, the meteorology
 * network of the Air Force (DECEA). Its API, as its reference describes it
 * (ajuda.decea.mil.br, "API-REDEMET: Mensagem METAR", read on 2026-10-09):
 *
 *   GET https://api-redemet.decea.mil.br/mensagens/metar/{localidades}
 *       ?api_key=...&data_ini=AAAAMMDDHH&data_fim=AAAAMMDDHH&page_tam=150
 *
 * answers `{ status, message, data: { current_page, last_page, data: [...] } }`,
 * each message `{ id_localidade, validade_inicial, mens, recebimento }`, with
 * history since 2003-01-01. The key comes from registration at
 * api-redemet.decea.mil.br/cadastro-api, is the platform's (not a firm's) and
 * lives in the server's environment. Times are UTC, as aviation writes them.
 *
 * None of it has run against REDEMET yet: the contract test answers in the
 * shapes of that reference.
 */

export const REDEMET_BASE_URL = "https://api-redemet.decea.mil.br";

/** The key was refused (missing, wrong, or no longer valid). */
export class RedemetAuthError extends Error {
  constructor() {
    super("redemet_key_refused");
    this.name = "RedemetAuthError";
  }
}

/** REDEMET did not answer, asked to slow down, or answered something that cannot be read. */
export class RedemetUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? "redemet_no_answer" : `redemet_http_${status}`);
    this.name = "RedemetUnavailableError";
    this.status = status;
  }
}

export type RedemetConfig = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Messages per page; the reference's default is 150. */
  pageSize?: number;
  /** The most pages one request follows: a day of an airport is a page or two. */
  maxPages?: number;
};

type Message = { id_localidade?: string; validade_inicial?: string; mens?: string };
type Page = { status?: boolean; message?: unknown; data?: { current_page?: number; last_page?: number; data?: Message[] } };

/** `AAAAMMDDHH` of an instant, in UTC. */
function hourStamp(instant: number): string {
  const date = new Date(instant);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}`;
}

/** `2026-10-05 10:00:00` (UTC, as REDEMET writes it) as an ISO instant; null when it is not one. */
function instantOf(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value ?? "");
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? "00"}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

export class RedemetProvider implements WeatherProvider {
  private readonly config: RedemetConfig;

  constructor(config: RedemetConfig) {
    this.config = config;
  }

  async getMetar(input: { icao: string; from: string; to: string }): Promise<Metar[]> {
    const icao = input.icao.trim().toUpperCase();
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    if (!/^[A-Z0-9]{4}$/.test(icao) || Number.isNaN(from) || Number.isNaN(to) || to < from) return [];

    const found = new Map<string, Metar>();
    const maxPages = this.config.maxPages ?? 10;
    for (let page = 1; page <= maxPages; page += 1) {
      // Whole hours are asked for: the one the window starts in, and the one after it ends in, so a
      // report of the last partial hour is never left out. The window itself cuts to the minute below.
      const answer = await this.page(icao, hourStamp(from), hourStamp(to + 3_599_999), page);
      for (const message of answer.data?.data ?? []) {
        const observedAt = instantOf(message.validade_inicial);
        // REDEMET ends each message with "=", the end mark of the bulletin, which is not part of the report.
        const raw = (message.mens ?? "").trim().replace(/=+$/, "").trim();
        if (!observedAt || !raw || (message.id_localidade ?? icao).toUpperCase() !== icao) continue;
        const at = Date.parse(observedAt);
        // The hours asked for are whole; the window itself is to the minute.
        if (at < from || at > to) continue;
        found.set(`${observedAt}|${raw}`, { icao, observedAt, raw });
      }
      if ((answer.data?.current_page ?? page) >= (answer.data?.last_page ?? page)) break;
    }
    return [...found.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  private async page(icao: string, start: string, end: string, page: number): Promise<Page> {
    const url = new URL(`/mensagens/metar/${icao}`, this.config.baseUrl ?? REDEMET_BASE_URL);
    url.searchParams.set("api_key", this.config.apiKey);
    url.searchParams.set("data_ini", start);
    url.searchParams.set("data_fim", end);
    url.searchParams.set("page_tam", String(this.config.pageSize ?? 150));
    url.searchParams.set("page", String(page));
    const run = this.config.fetch ?? fetch;
    let response: Response;
    try {
      response = await run(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 20_000),
      });
    } catch {
      throw new RedemetUnavailableError(null);
    }
    if (response.status === 401 || response.status === 403) throw new RedemetAuthError();
    if (!response.ok) throw new RedemetUnavailableError(response.status);
    let body: Page;
    try {
      body = (await response.json()) as Page;
    } catch {
      throw new RedemetUnavailableError(response.status);
    }
    if (body.status === false) throw new RedemetUnavailableError(response.status);
    return body;
  }
}
