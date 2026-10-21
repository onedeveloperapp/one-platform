import type { ProceedingRead, ProceedingSource } from "@flyee/courts/types";

/**
 * The comparative test of sources of the course of lawsuits (an aggregator
 * against another, and each against a court's own system where ONE reads
 * one): every source asked about the same sample of lawsuits, and each
 * measured against what all of them saw together. Nobody's word is the
 * truth: a source is behind when another one saw a later movement of the
 * same lawsuit, and it misses a day when another one saw a movement that
 * day. A court's own system (Projudi) takes part as one more source.
 *
 * Pure but for `askAll`, which calls the sources it is handed.
 */

/** One source asked about one lawsuit. */
export type SourceTry = {
  source: string;
  cnj: string;
  /** How long it took to answer, in milliseconds. */
  ms: number;
  read: ProceedingRead | null;
  /** Why it did not answer, when it did not. */
  error: string | null;
};

export type SourceScore = {
  source: string;
  /** Lawsuits of the sample it covers, and of those how many it found, did not find, or failed on. */
  asked: number;
  found: number;
  notFound: number;
  failed: number;
  /** The middle of its answer times. */
  medianMs: number | null;
  /** Of the days with movements any source saw in the lawsuits it found, the share it saw too (0 to 1). */
  dayCoverage: number | null;
  /**
   * Lawsuits it found whose latest movement is of an earlier day (in Brasília) than the latest any source saw,
   * or that it found with no movement while another saw some; and by how many days, of the ones it has a
   * movement of. Days, never hours: a source may give the day of a movement and no hour.
   */
  behind: number;
  medianLagDays: number | null;
  /** Lawsuits another source found and it said it does not have. */
  missed: number;
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** The day of an instant in Brasília, the day the courts count by. */
const dayOf = (iso: string): string => new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10);

const DAY = 86_400_000;

/** Each source scored against what every source saw together, in the order the sources were first asked. */
export function compareSources(tries: readonly SourceTry[]): SourceScore[] {
  const sources = [...new Set(tries.map((attempt) => attempt.source))];
  const byCnj = new Map<string, SourceTry[]>();
  for (const attempt of tries) byCnj.set(attempt.cnj, [...(byCnj.get(attempt.cnj) ?? []), attempt]);

  // What all of them saw of each lawsuit: the days with movements, and the latest movement.
  const together = new Map<string, { days: Set<string>; latest: string | null; foundBy: number }>();
  for (const [cnj, attempts] of byCnj) {
    const days = new Set<string>();
    let latest: string | null = null;
    let foundBy = 0;
    for (const attempt of attempts) {
      if (!attempt.read?.found) continue;
      foundBy += 1;
      for (const movement of attempt.read.movements) {
        days.add(dayOf(movement.at));
        const day = dayOf(movement.at);
        if (latest === null || day > latest) latest = day;
      }
    }
    together.set(cnj, { days, latest, foundBy });
  }

  return sources.map((source) => {
    const mine = tries.filter((attempt) => attempt.source === source);
    const found = mine.filter((attempt) => attempt.read?.found);
    let seen = 0;
    let all = 0;
    const lags: number[] = [];
    let behind = 0;
    for (const attempt of found) {
      if (!attempt.read?.found) continue;
      const whole = together.get(attempt.cnj);
      if (!whole) continue;
      const days = new Set(attempt.read.movements.map((movement) => dayOf(movement.at)));
      all += whole.days.size;
      seen += [...whole.days].filter((day) => days.has(day)).length;
      const latest = [...days].sort().at(-1) ?? null;
      if (whole.latest === null || (latest !== null && latest >= whole.latest)) continue;
      behind += 1;
      if (latest !== null) lags.push((Date.parse(whole.latest) - Date.parse(latest)) / DAY);
    }
    return {
      source,
      asked: mine.length,
      found: found.length,
      notFound: mine.filter((attempt) => attempt.read && !attempt.read.found).length,
      failed: mine.filter((attempt) => attempt.error !== null).length,
      medianMs: median(mine.filter((attempt) => attempt.error === null).map((attempt) => attempt.ms)),
      dayCoverage: all > 0 ? seen / all : null,
      behind,
      medianLagDays: median(lags),
      missed: mine.filter((attempt) => attempt.read && !attempt.read.found && (together.get(attempt.cnj)?.foundBy ?? 0) > 0).length,
    };
  });
}

/**
 * Every source asked about every lawsuit of the sample it covers, one call at a time (a source's own pace
 * is its own: Projudi waits between calls), each answer timed. A failure is kept as one, never as "not
 * found".
 */
export async function askAll(
  sources: readonly ProceedingSource[],
  cnjs: readonly string[],
  clock: () => number = Date.now,
): Promise<SourceTry[]> {
  const tries: SourceTry[] = [];
  for (const cnj of cnjs) {
    for (const source of sources) {
      if (!source.covers(cnj)) continue;
      const started = clock();
      try {
        const read = await source.read(cnj);
        tries.push({ source: source.name, cnj, ms: clock() - started, read, error: null });
      } catch (error) {
        tries.push({ source: source.name, cnj, ms: clock() - started, read: null, error: error instanceof Error ? error.message : "failed" });
      }
    }
  }
  return tries;
}

/** The court of a CNJ number (its segment and tribunal, "809" for TJGO): what a comparison is told apart by. */
export const courtOf = (cnj: string): string => cnj.slice(13, 16);
