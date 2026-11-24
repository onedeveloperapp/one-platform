/**
 * The history of a lawsuit filed before its case was in ONE (migration 0286), as the case says it: ONE reads what the
 * DJEN has of the lawsuit by its number, once. Pure: the case's loader and its card of publications read it.
 */

/** ONE's reading of a lawsuit's history: owed, read with how many publications came of it, or given up. */
export type HistoryRead = { proceedingId: string; status: "due" | "done" | "failed"; kept: number | null };

const STATUSES = new Set(["due", "done", "failed"]);

/** The rows of `proceeding_history_reads` a case reads, as they are said; anything else is left out. */
export function historyReadsOf(rows: readonly unknown[]): HistoryRead[] {
  return rows.flatMap((raw) => {
    const row = (raw ?? {}) as { proceeding_id?: unknown; status?: unknown; kept?: unknown };
    if (typeof row.proceeding_id !== "string" || typeof row.status !== "string" || !STATUSES.has(row.status)) return [];
    const kept = typeof row.kept === "number" && Number.isFinite(row.kept) ? row.kept : null;
    return [{ proceedingId: row.proceeding_id, status: row.status as HistoryRead["status"], kept }];
  });
}

/**
 * Where a lawsuit's history stands on the case:
 *   ask     filed before the case was in ONE (recorded by hand) and never read: a lawyer may have ONE read it;
 *   due     ONE reads it;
 *   done    read, with how many publications came of it;
 *   failed  ONE could not read it: a lawyer may have ONE try again.
 */
export type HistoryLine = { proceedingId: string; cnj: string; kind: "ask" | "due" | "done" | "failed"; kept: number };

/**
 * A line for each lawsuit filed whose history ONE reads or read, or that was filed before the case was in ONE
 * (`openedOn`, the day the case was opened in Brasília); none for a lawsuit filed through ONE, whose publications the
 * DJEN gives the firm's lawyers from the day it was filed.
 */
export function historyLines(
  proceedings: readonly { id: string; status: string; cnj: string | null; filedAt: string | null }[],
  histories: readonly HistoryRead[],
  openedOn: string,
): HistoryLine[] {
  return proceedings.flatMap((proceeding) => {
    if (proceeding.status !== "filed" || !proceeding.cnj || !/^\d{20}$/.test(proceeding.cnj)) return [];
    const history = histories.find((read) => read.proceedingId === proceeding.id);
    const before = proceeding.filedAt !== null && proceeding.filedAt.slice(0, 10) < openedOn;
    if (!history && !before) return [];
    return [
      {
        proceedingId: proceeding.id,
        cnj: proceeding.cnj,
        kind: history ? history.status : "ask",
        kept: history?.kept ?? 0,
      },
    ];
  });
}
