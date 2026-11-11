import { oabNumberKey, oabStateKey } from "@flyee/courts/oab";
import { hostOfLink, isEmptyText, kindOfCommunication, systemOfHost } from "@flyee/courts/djen-systems";
import type { DjenClient, DjenCommunication, DjenProbe, OabRegistration } from "@flyee/courts/types";

/**
 * The DJEN (Diário de Justiça Eletrônico Nacional, CNJ Resolution 455/2022)
 * through its public API. What is written here was read in its reference
 * (the OpenAPI document of comunicaapi.pje.jus.br, on 2026-10-08) and then
 * checked against the API itself on 2026-10-09, by the shape of its answers
 * only:
 *
 *   GET https://comunicaapi.pje.jus.br/api/v1/comunicacao
 *       ?numeroOab=...&ufOab=..&dataDisponibilizacaoInicio=yyyy-mm-dd
 *       &dataDisponibilizacaoFim=yyyy-mm-dd&pagina=1&itensPorPagina=100
 *
 * answers `{ status: "success", message, count, items: [...] }` with no
 * login. What the check found, and the code below depends on:
 *
 * - `count` is NOT a total to end a listing by. It came as the total for one
 *   search, as the size of the page for another and as 10,000 for a third.
 *   A listing ends at a page that is not full, and `count` is read only as a
 *   warning: at or past the ceiling the days hold more than a search gives,
 *   and above what was read at the end the listing is not whole.
 * - A search gives 10,000 results at most: the page after them answers an
 *   error. It is never asked for.
 * - The last day asked is included, and the newest comes first: a search of
 *   one day gives that day, and a search of two gives the later one on its
 *   first page (asked again on 2026-10-09).
 * - A request the API does not like (a day that is not one, a page past the
 *   ceiling) answers 500 with `status: "error"` and the words it uses when it
 *   is busy: it cannot be told from an outage.
 * - The number of a registration is matched exactly, letter included: asked
 *   for the digits alone, the API gives nothing of "123456A". So the number
 *   is asked for as it is registered (`oabNumberKey`).
 * - The API counts calls per address (`x-ratelimit-limit: 20`,
 *   `x-ratelimit-remaining`); on a 429 its reference asks to wait a minute
 *   before asking again, and calls the use of several addresses to get
 *   around the limit abuse. So this client paces itself: it waits when the
 *   window is spent, and gives up (`DjenRateLimitedError`) rather than
 *   insist, leaving the capture to try again later. Twenty calls a window
 *   and the waits one listing may take are a ceiling of their own, well
 *   under the 10,000 of a search: a listing that read a window's worth of
 *   pages and still has no end within its waits or its time is too long
 *   for one turn, and says so the way it says a search is too large
 *   (`DjenWindowTooLargeError`), so the capture asks for fewer days. Asked
 *   again as it was, it would meet the same wall for ever.
 * - A text may be a whole HTML document (the courts on eproc publish one),
 *   or plain text with the named characters of an editor.
 *
 * A listing is whole or it is an error: a publication left unread is a
 * deadline nobody saw. So what cannot be asked (a registration or a day that
 * is not one) is an error too, never a listing with nothing in it, which
 * the capture would record as days read. And nothing addressed to the
 * registration is left out here for being odd: a communication with no hash
 * or a case number that is not one is handed over as it came, for the
 * capture to refuse and count. What the API answered that does not name the
 * registration asked for is left out and counted (`onFiltered`): by what
 * was checked it should be nothing, so a count above none is worth a look.
 */

export const DJEN_BASE_URL = "https://comunicaapi.pje.jus.br";

/** The certificate of a communication, as the DJEN itself issues it: a public address, by the hash. */
export function djenCertificateUrl(hash: string, baseUrl: string = DJEN_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/comunicacao/${encodeURIComponent(hash)}/certidao`;
}

/**
 * The DJEN did not answer, answered an error, or answered something that
 * cannot be read as a whole listing. `status` is the HTTP status when there
 * was one: an error with a status may be the API refusing what was asked.
 */
export class DjenUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null, reason = "") {
    super(`${status === null ? "djen_no_answer" : `djen_http_${status}`}${reason ? `_${reason}` : ""}`);
    this.name = "DjenUnavailableError";
    this.status = status;
  }
}

/** The window of calls is spent and waiting more would pass what this call may wait: try again later. */
export class DjenRateLimitedError extends Error {
  constructor() {
    super("djen_rate_limited");
    this.name = "DjenRateLimitedError";
  }
}

/**
 * The days asked hold more than one listing reads: as much as a search
 * gives or more, or more than the calls and the time of one turn. What lies
 * past it cannot be read. Ask for fewer days.
 */
export class DjenWindowTooLargeError extends Error {
  constructor() {
    super("djen_window_too_large");
    this.name = "DjenWindowTooLargeError";
  }
}

/** What was asked is nothing the DJEN can be asked: a registration that is not one, or a day that is not a day. */
export class DjenInvalidQueryError extends Error {
  constructor(what: "registration" | "days") {
    super(`djen_invalid_${what}`);
    this.name = "DjenInvalidQueryError";
  }
}

export type DjenConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The last day asked: today in Brazil's official time, as YYYY-MM-DD. */
  today?: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** How long to wait when the window is spent or a 429 arrives. The reference asks for a minute. */
  backoffMs?: number;
  /** The most one listing waits in all before giving up. */
  maxWaitMs?: number;
  /** The most pages one listing follows, of 100 each: 100 pages are the API's own ceiling for a search. */
  maxPages?: number;
  /** The most time one listing takes in all, its waits included: a step of a job has minutes, not more. */
  maxListingMs?: number;
  /** The clock the time of a listing is counted by. */
  now?: () => number;
  /** Told how many communications of a listing did not name the registration asked for, when any did not. */
  onFiltered?: (communications: number) => void;
};

const PAGE_SIZE = 100;
/** The calls a window gives when the API does not say: what its reference says. */
const CALLS_A_WINDOW = 20;

type Lawyer = { advogado?: { numero_oab?: unknown; uf_oab?: unknown } | null };
type Item = {
  hash?: unknown;
  siglaTribunal?: unknown;
  numero_processo?: unknown;
  data_disponibilizacao?: unknown;
  tipoComunicacao?: unknown;
  tipoDocumento?: unknown;
  texto?: unknown;
  link?: unknown;
  nomeOrgao?: unknown;
  nomeClasse?: unknown;
  codigoClasse?: unknown;
  ativo?: unknown;
  motivo_cancelamento?: unknown;
  data_cancelamento?: unknown;
  destinatarioadvogados?: Lawyer[] | null;
};
type Page = { status?: unknown; count?: unknown; items?: Item[] | null };

const text = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
const digits = (value: unknown): string => text(value).replace(/\D/g, "");

const todayInBrazil = (): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** A day as the API writes it: `2026-10-08`, or the same day with a time after it. */
const dayOf = (value: unknown): string => text(value).slice(0, 10);

/**
 * True when the court took the communication back. The answer says so in
 * more than one place, and none of them is trusted alone: a flag that is not
 * plainly "yes" is a cancelling, and so is a day or a reason of one.
 */
function cancelled(item: Item): boolean {
  const flag = item.ativo;
  if (flag === false || flag === 0) return true;
  if (typeof flag === "string" && /^(?:false|0|n|n[ãa]o|inativo)$/i.test(flag.trim())) return true;
  return text(item.data_cancelamento).trim() !== "" || text(item.motivo_cancelamento).trim() !== "";
}

export class DjenHttpClient implements DjenClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly today: () => string;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly backoffMs: number;
  private readonly maxWaitMs: number;
  private readonly maxPages: number;
  private readonly maxListingMs: number;
  private readonly now: () => number;
  private readonly onFiltered: ((communications: number) => void) | null;

  constructor(config: DjenConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DJEN_BASE_URL).replace(/\/+$/, "");
    this.fetcher = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.today = config.today ?? todayInBrazil;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.backoffMs = config.backoffMs ?? 61_000;
    this.maxWaitMs = config.maxWaitMs ?? 130_000;
    this.maxPages = config.maxPages ?? 100;
    this.maxListingMs = config.maxListingMs ?? 140_000;
    this.now = config.now ?? Date.now;
    this.onFiltered = config.onFiltered ?? null;
  }

  certificateUrl(hash: string): string {
    return djenCertificateUrl(hash, this.baseUrl);
  }

  async listByOab(input: OabRegistration & { since: string; until?: string }): Promise<DjenCommunication[]> {
    const uf = oabStateKey(input.uf);
    const number = oabNumberKey(input.number);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    // Refused, never answered with nothing: a listing with nothing in it is days that were read.
    if (!/^[A-Z]{2}$/.test(uf) || !/^\d{1,9}[A-Z]{0,2}$/.test(number)) throw new DjenInvalidQueryError("registration");
    if (!day.test(input.since) || (input.until !== undefined && !day.test(input.until))) {
      throw new DjenInvalidQueryError("days");
    }
    const today = this.today();
    // Nothing is made available on a day that has not come.
    const until = input.until !== undefined && input.until < today ? input.until : today;
    if (input.since > until) return [];
    const ceiling = this.maxPages * PAGE_SIZE;
    const started = this.now();

    const found = new Map<string, DjenCommunication>();
    /** What came with no hash: nothing to tell two of them apart by, so each is kept. */
    const unkeyed: DjenCommunication[] = [];
    let read = 0;
    let pages = 0;
    let dropped = 0;
    let window = CALLS_A_WINDOW;
    let waited = 0;
    /**
     * This listing read a window's worth of pages by itself and has no end yet: it is the listing that is
     * long, not the calls of others or a slow moment. Fewer days hold fewer.
     */
    const long = () => pages >= window;
    const wait = async () => {
      if (waited + this.backoffMs > this.maxWaitMs) throw long() ? new DjenWindowTooLargeError() : new DjenRateLimitedError();
      waited += this.backoffMs;
      await this.sleep(this.backoffMs);
    };

    let whole = false;
    for (let page = 1; page <= this.maxPages; page += 1) {
      const query = new URLSearchParams({
        numeroOab: number,
        ufOab: uf,
        dataDisponibilizacaoInicio: input.since,
        dataDisponibilizacaoFim: until,
        pagina: String(page),
        itensPorPagina: String(PAGE_SIZE),
      });
      let response: Response;
      for (;;) {
        // A listing has the time of one turn, its waits included.
        if (this.now() - started > this.maxListingMs) {
          throw long() ? new DjenWindowTooLargeError() : new DjenUnavailableError(null, "slow");
        }
        response = await this.get(`${this.baseUrl}/api/v1/comunicacao?${query}`);
        if (response.status !== 429) break;
        await wait();
      }
      if (!response.ok) throw new DjenUnavailableError(response.status);
      let body: Page;
      try {
        body = (await response.json()) as Page;
      } catch {
        throw new DjenUnavailableError(response.status, "unreadable");
      }
      const items = body && Array.isArray(body.items) ? body.items : null;
      // An answer that says it failed is not a listing with nothing in it.
      if (!items || (body.status !== undefined && body.status !== "success")) {
        throw new DjenUnavailableError(response.status, "not_a_listing");
      }
      const said = typeof body.count === "number" && Number.isFinite(body.count) ? body.count : null;
      // As many as a search gives, or a count that stopped at the ceiling: never taken for the whole.
      if (said !== null && said >= ceiling) throw new DjenWindowTooLargeError();
      read += items.length;
      pages += 1;
      const limit = Number(response.headers.get("x-ratelimit-limit")?.trim());
      if (Number.isInteger(limit) && limit > 0) window = limit;

      for (const item of items) {
        // Only what names this very registration: a number alone exists in every state, and with
        // another letter it is another lawyer.
        const addressed = (item.destinatarioadvogados ?? []).some(
          (lawyer) =>
            oabNumberKey(lawyer?.advogado?.numero_oab) === number && oabStateKey(lawyer?.advogado?.uf_oab) === uf,
        );
        if (!addressed) {
          dropped += 1;
          continue;
        }
        const hash = text(item.hash).trim();
        const link = text(item.link).trim();
        const inactive = cancelled(item);
        const communication: DjenCommunication = {
          hash,
          court: text(item.siglaTribunal).trim().toUpperCase(),
          cnj: digits(item.numero_processo),
          availableOn: dayOf(item.data_disponibilizacao),
          kind: text(item.tipoComunicacao).trim(),
          documentType: text(item.tipoDocumento).trim() || null,
          text: text(item.texto),
          link: /^https?:\/\//i.test(link) ? link : null,
          unit: text(item.nomeOrgao).trim() || null,
          className: text(item.nomeClasse).trim() || null,
          active: !inactive,
          cancelReason: inactive ? text(item.motivo_cancelamento).trim() || null : null,
        };
        if (hash) found.set(hash, communication);
        else unkeyed.push(communication);
      }

      if (items.length < PAGE_SIZE) {
        // The page that ends a listing. When the API said how many there are and fewer were read, it is not the end.
        if (said !== null && said > read) throw new DjenUnavailableError(response.status, "incomplete");
        whole = true;
        break;
      }
      // The window says how many calls are left: with none, the next page waits for the next window.
      // An answer that does not say is not an answer that says zero.
      const left = response.headers.get("x-ratelimit-remaining")?.trim();
      if (left && Number.isFinite(Number(left)) && Number(left) <= 0) await wait();
    }
    // Every page it may follow came full: what lies past them was not read.
    if (!whole) throw new DjenWindowTooLargeError();
    if (dropped > 0) this.onFiltered?.(dropped);

    return [...found.values(), ...unkeyed].sort(
      (a, b) => a.availableOn.localeCompare(b.availableOn) || a.hash.localeCompare(b.hash),
    );
  }

  async probe(input: { court: string; day: string }): Promise<DjenProbe> {
    const court = input.court.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(court) || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new DjenInvalidQueryError("days");
    const query = new URLSearchParams({
      siglaTribunal: court,
      dataDisponibilizacaoInicio: input.day,
      dataDisponibilizacaoFim: input.day,
      pagina: "1",
      itensPorPagina: String(PAGE_SIZE),
    });
    const response = await this.get(`${this.baseUrl}/api/v1/comunicacao?${query}`);
    if (response.status === 429) throw new DjenRateLimitedError();
    if (!response.ok) throw new DjenUnavailableError(response.status);
    let body: Page;
    try {
      body = (await response.json()) as Page;
    } catch {
      throw new DjenUnavailableError(response.status, "unreadable");
    }
    const items = body && Array.isArray(body.items) ? body.items : null;
    if (!items || (body.status !== undefined && body.status !== "success")) {
      throw new DjenUnavailableError(response.status, "not_a_listing");
    }
    const probe: DjenProbe = { items: items.length, withoutText: 0, systems: {} };
    for (const item of items) {
      if (isEmptyText(text(item.texto))) probe.withoutText += 1;
      const kind = kindOfCommunication({
        classCode: Number.isFinite(Number(item.codigoClasse)) ? Number(item.codigoClasse) : null,
        className: text(item.nomeClasse),
        unit: text(item.nomeOrgao),
      });
      const system = systemOfHost(hostOfLink(text(item.link).trim()));
      if (!kind || !system) continue;
      const bucket = (probe.systems[kind] ??= {});
      bucket[system] = (bucket[system] ?? 0) + 1;
    }
    return probe;
  }

  private async get(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, { headers: { accept: "application/json" }, signal: controller.signal });
    } catch {
      throw new DjenUnavailableError(null);
    } finally {
      clearTimeout(timer);
    }
  }
}
