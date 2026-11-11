import { type IndexAnswer, type IndexSeries, type IndexSource, type Month, normalizeMonth } from "@flyee/indices/types";

/**
 * The Banco Central's public time series (SGS), with no key: `api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados`,
 * answered in JSON as a list of `{ "data": "dd/MM/yyyy", "valor": "0.42" }`, the value with a dot. The series read:
 * 433, the IPCA's monthly variation, and 4390, the Selic accumulated in the month, both in percent. A range with no
 * value answers 404, which is a reading with nothing in it; anything else that is not a list is `unavailable`.
 */

const CODES: Record<IndexSeries, number> = { ipca: 433, selic: 4390 };
const BASE = "https://api.bcb.gov.br/dados/serie";

export type BcbConfig = { fetch?: typeof fetch; timeoutMs?: number };

const firstDay = (month: Month): string => `01/${month.slice(5, 7)}/${month.slice(0, 4)}`;
function lastDay(month: Month): string {
  const [year, value] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return `${String(day).padStart(2, "0")}/${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

export class BcbIndexSource implements IndexSource {
  private readonly run: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: BcbConfig = {}) {
    this.run = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  async monthly(series: IndexSeries, from: Month, to: Month): Promise<IndexAnswer> {
    const start = normalizeMonth(from);
    const end = normalizeMonth(to);
    const url =
      `${BASE}/bcdata.sgs.${CODES[series]}/dados?formato=json` +
      `&dataInicial=${encodeURIComponent(firstDay(start))}&dataFinal=${encodeURIComponent(lastDay(end))}`;
    let response: Response;
    try {
      response = await this.run(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      return { kind: "unavailable", detail: "network" };
    }
    if (response.status === 404) return { kind: "read", rates: {} };
    if (!response.ok) return { kind: "unavailable", detail: `status_${response.status}` };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "unavailable", detail: "not_json" };
    }
    if (!Array.isArray(body)) return { kind: "unavailable", detail: "not_a_list" };
    const rates: Record<Month, number> = {};
    for (const row of body as { data?: unknown; valor?: unknown }[]) {
      const day = typeof row?.data === "string" ? row.data : "";
      const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(day);
      const value = Number(String(row?.valor ?? "").replace(",", "."));
      if (!match || !Number.isFinite(value)) continue;
      const month = `${match[3]}-${match[2]}`;
      if (month >= start && month <= end) rates[month] = value;
    }
    return { kind: "read", rates };
  }
}
