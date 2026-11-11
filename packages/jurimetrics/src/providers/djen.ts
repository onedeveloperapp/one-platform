import { readMarketDecision } from "@flyee/jurimetrics/read";
import type { MarketDecision, MarketListing, MarketQuery, MarketSource } from "@flyee/jurimetrics/types";
import { MarketUnavailableError } from "@flyee/jurimetrics/types";

/**
 * The DJEN's public API as a source of decisions (no key): the communications a court made available on a day that
 * name a party (`nomeParte`, the airline as the court writes it) and the court (`siglaTribunal`), a page of 100 at a
 * time, as `@flyee/courts/providers/djen` reads them by registration (a listing ends at a page not full; the API
 * counts calls per address, so each call waits its turn and a day that holds more than the pages one reading takes is
 * said incomplete, never as whole). Each communication is read by `mercado-v1` and only a decision is kept, with its
 * unit, judge and airline: never a passenger's name, nor the lawsuit's number.
 */
export const MARKET_DJEN_BASE_URL = "https://comunicaapi.pje.jus.br";

export type MarketDjenConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** The pause between two calls, in milliseconds: the API's window is 20 calls (its reference). */
  pauseMs?: number;
  /** The most pages one day reads. */
  maxPages?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

const PAGE_SIZE = 100;
type Item = { hash?: unknown; siglaTribunal?: unknown; texto?: unknown; nomeOrgao?: unknown; ativo?: unknown };
const text = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

export class MarketDjenSource implements MarketSource {
  readonly name = "djen";
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly pauseMs: number;
  private readonly maxPages: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: MarketDjenConfig = {}) {
    this.baseUrl = (config.baseUrl ?? MARKET_DJEN_BASE_URL).replace(/\/+$/, "");
    this.fetcher = config.fetch ?? fetch;
    this.pauseMs = config.pauseMs ?? 3_500;
    this.maxPages = config.maxPages ?? 5;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async decisionsOn(query: MarketQuery): Promise<MarketListing> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.day) || !query.party.trim() || !/^[A-Z]{2,6}$/.test(query.court)) {
      return { decisions: [], read: 0, complete: true };
    }
    const decisions = new Map<string, MarketDecision>();
    let read = 0;
    for (let page = 1; page <= this.maxPages; page += 1) {
      if (page > 1) await this.sleep(this.pauseMs);
      const params = new URLSearchParams({
        nomeParte: query.party,
        siglaTribunal: query.court,
        dataDisponibilizacaoInicio: query.day,
        dataDisponibilizacaoFim: query.day,
        pagina: String(page),
        itensPorPagina: String(PAGE_SIZE),
      });
      const response = await this.get(`${this.baseUrl}/api/v1/comunicacao?${params}`);
      if (!response.ok) throw new MarketUnavailableError(response.status);
      let body: { status?: unknown; items?: Item[] | null };
      try {
        body = (await response.json()) as { status?: unknown; items?: Item[] | null };
      } catch {
        throw new MarketUnavailableError(response.status);
      }
      const items = body && Array.isArray(body.items) ? body.items : null;
      if (!items || (body.status !== undefined && body.status !== "success")) {
        throw new MarketUnavailableError(response.status);
      }
      read += items.length;
      for (const item of items) {
        // A communication the court took back is no decision of the market.
        if (item.ativo === false || item.ativo === 0) continue;
        const decision = readMarketDecision({
          key: text(item.hash).trim(),
          court: text(item.siglaTribunal).trim().toUpperCase() || query.court,
          unit: text(item.nomeOrgao).trim() || null,
          party: query.party,
          day: query.day,
          text: text(item.texto),
        });
        if (decision) decisions.set(decision.key, decision);
      }
      if (items.length < PAGE_SIZE) {
        return { decisions: [...decisions.values()], read, complete: true };
      }
    }
    return { decisions: [...decisions.values()], read, complete: false };
  }

  private async get(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(url, { headers: { accept: "application/json" }, signal: controller.signal });
    } catch {
      throw new MarketUnavailableError(null);
    } finally {
      clearTimeout(timer);
    }
  }
}
