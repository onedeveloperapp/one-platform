import { caseLabel } from "@/lib/cases/cases";
import type { QueuedFiling } from "@/lib/cases/filing-facts";

/**
 * The firm's filing queue as a list of the screen pattern (the bar of every list, 2026-11-07): its ready views, its
 * search, its filters by court and system and its order. The queue is read whole (at most `QUEUE_SHOWN` packages),
 * so all of it is decided here, in the browser, and never asks the server again. Pure, so the counts of the cards
 * and of the views are the very rows the list shows.
 */

/** The ready views of the queue, in the order the bar lists them. */
export const QUEUE_VIEWS = ["todos", "prontos", "montagem", "impedidos", "falha"] as const;
export type QueueView = (typeof QUEUE_VIEWS)[number];

export const isQueueView = (value: unknown): value is QueueView =>
  typeof value === "string" && (QUEUE_VIEWS as readonly string[]).includes(value);

/** The orders the queue offers: the package asked for the longest first (the queue's own), or the latest. */
export const QUEUE_SORTS = ["oldest", "newest"] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];

export const isQueueSort = (value: unknown): value is QueueSort =>
  typeof value === "string" && (QUEUE_SORTS as readonly string[]).includes(value);

/**
 * Whether a package is in a view. Ready to file is ready with nothing keeping its lawsuit from being filed: a package
 * something blocks waits for that before anybody files it, so it is counted where it is blocked, never as ready.
 */
export function inQueueView(row: QueuedFiling, view: QueueView): boolean {
  switch (view) {
    case "todos":
      return true;
    case "prontos":
      return row.status === "ready" && !row.blocker;
    case "montagem":
      return row.status === "requested";
    case "impedidos":
      return row.status !== "failed" && Boolean(row.blocker);
    case "falha":
      return row.status === "failed";
  }
}

/** The filters of the list beside its view: a court and a system, each as the rows write it. */
export type QueueQuery = {
  view: QueueView;
  search: string;
  court: string | null;
  system: string | null;
  sort: QueueSort;
};

/** Words compared as a person types them: no accents, no case, single spaces. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Whether a package answers the search: every word typed is in the client's name, the case's number ("#12" or
 * "12"), the comarca or the court. A search of nothing finds every package.
 */
export function queueMatches(row: QueuedFiling, search: string): boolean {
  const words = folded(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = folded(
    [row.client, row.caseSeq !== null ? caseLabel(row.caseSeq) : "", row.comarca ?? "", row.court].join(" "),
  );
  return words.every((word) => haystack.includes(word.replace(/^#/, "")));
}

/** The rows a filter of the bar leaves, before the view: the search, the court and the system. */
function filtered(rows: QueuedFiling[], query: Omit<QueueQuery, "view" | "sort">): QueuedFiling[] {
  return rows.filter(
    (row) =>
      (query.court === null || row.court === query.court) &&
      (query.system === null || row.system === query.system) &&
      queueMatches(row, query.search),
  );
}

/** How many packages each view holds under the search and the filters: the numbers the bar and the cards say. */
export function queueCounts(rows: QueuedFiling[], query: Omit<QueueQuery, "view" | "sort">): Record<QueueView, number> {
  const left = filtered(rows, query);
  return Object.fromEntries(
    QUEUE_VIEWS.map((view) => [view, left.filter((row) => inQueueView(row, view)).length]),
  ) as Record<QueueView, number>;
}

/** The rows the list shows, in the order asked; the order of a tie is the queue's own. */
export function queueRows(rows: QueuedFiling[], query: QueueQuery): QueuedFiling[] {
  const shown = filtered(rows, query).filter((row) => inQueueView(row, query.view));
  const sign = query.sort === "newest" ? -1 : 1;
  return shown
    .map((row, index) => ({ row, index }))
    .sort((a, b) => sign * a.row.requestedAt.localeCompare(b.row.requestedAt) || a.index - b.index)
    .map(({ row }) => row);
}

/** The courts and the systems the queue holds, for the filter's fields: each once, in the order of their names. */
export function queueFacets(rows: QueuedFiling[]): { courts: string[]; systems: string[] } {
  const once = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { courts: once(rows.map((row) => row.court)), systems: once(rows.map((row) => row.system)) };
}

/**
 * The groups the list shows, one per court and system, since a lawyer files a run of them in one system with one
 * login: the groups with a package ready to file first, then by court; inside each, the rows in the order asked.
 */
export function queueGroups(
  rows: QueuedFiling[],
): { key: string; court: string; system: string; rows: QueuedFiling[] }[] {
  const groups = new Map<string, QueuedFiling[]>();
  for (const row of rows) {
    const key = `${row.court}|${row.system}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const hasReady = (list: QueuedFiling[]) => Number(list.some((row) => inQueueView(row, "prontos")));
  return [...groups.entries()]
    .sort(([, a], [, b]) => hasReady(b) - hasReady(a) || a[0].court.localeCompare(b[0].court, "pt-BR"))
    .map(([key, list]) => ({ key, court: list[0].court, system: list[0].system, rows: list }));
}
