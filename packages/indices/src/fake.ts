import { type IndexAnswer, type IndexSeries, type IndexSource, type Month, normalizeMonth } from "@flyee/indices/types";

/** The series in memory, deterministic: what a test or a machine with no network reads. */
export class FakeIndexSource implements IndexSource {
  private readonly rates: Record<IndexSeries, Record<Month, number>>;
  private readonly down: boolean;

  constructor(rates: Partial<Record<IndexSeries, Record<Month, number>>> = {}, options: { down?: boolean } = {}) {
    this.rates = { ipca: rates.ipca ?? {}, selic: rates.selic ?? {} };
    this.down = options.down === true;
  }

  async monthly(series: IndexSeries, from: Month, to: Month): Promise<IndexAnswer> {
    const start = normalizeMonth(from);
    const end = normalizeMonth(to);
    if (this.down) return { kind: "unavailable", detail: "down" };
    const rates: Record<Month, number> = {};
    for (const [month, rate] of Object.entries(this.rates[series])) {
      if (month >= start && month <= end) rates[month] = rate;
    }
    return { kind: "read", rates };
  }
}
