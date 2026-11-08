/**
 * The firm's conversations in the screen pattern (phase 0, migration 0109): the ready views of the inbox, its
 * orders, and what the database answers of a view (`firm_inbox`). Pure: the page and the search read the same rules,
 * and a view the database does not have is never asked for.
 */

/** The ready views, in the order the bar's menu lists them: every conversation, what waits, then the rest. */
export const INBOX_VIEWS = [
  "todas",
  "esperando",
  "fechando",
  "chamou",
  "resposta",
  "nao-lidas",
  "com-pessoa",
  "falhou",
  "pararam",
] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const isInboxView = (value: unknown): value is InboxView =>
  typeof value === "string" && (INBOX_VIEWS as readonly string[]).includes(value);

/** The group a view is listed under in the bar's menu: a line between groups. */
export const inboxViewGroup = (view: InboxView): "all" | "waits" | "other" =>
  view === "todas"
    ? "all"
    : view === "esperando" || view === "fechando" || view === "chamou" || view === "resposta" || view === "nao-lidas"
      ? "waits"
      : "other";

/** The numbers above the list, each the view it counts: what waits for the firm, the most urgent first. */
export const INBOX_CARDS = ["fechando", "esperando", "chamou", "resposta"] as const satisfies readonly InboxView[];

/** The latest message first, or the oldest first (who waits the longest, in a view of what waits). */
export const INBOX_SORTS = ["recent", "oldest"] as const;
export type InboxSort = (typeof INBOX_SORTS)[number];

export const isInboxSort = (value: unknown): value is InboxSort =>
  typeof value === "string" && (INBOX_SORTS as readonly string[]).includes(value);

/** How the order goes in the address: the default one is never written. */
export const SORT_PARAM: Record<InboxSort, string | null> = { recent: null, oldest: "antigas" };

export const sortOfParam = (value: unknown): InboxSort => (value === "antigas" ? "oldest" : "recent");

/** What a person asks of the list. The search travels in the request's body, never in the address. */
export type InboxListQuery = { view: InboxView; search: string; sort: InboxSort; module: string | null };

/** The longest search the database reads; the rest of what was typed is left out. */
export const SEARCH_MAX = 120;

/** What the person typed, read whole by the server action: anything that is not a query is the default list. */
export function inboxListQuery(input: unknown): InboxListQuery {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    view: isInboxView(raw.view) ? raw.view : "todas",
    search: typeof raw.search === "string" ? raw.search.trim().slice(0, SEARCH_MAX) : "",
    sort: isInboxSort(raw.sort) ? raw.sort : "recent",
    module: typeof raw.module === "string" && raw.module.trim() !== "" ? raw.module.trim() : null,
  };
}

export type InboxCounts = Record<InboxView, number>;

export const NO_COUNTS: InboxCounts = Object.fromEntries(INBOX_VIEWS.map((view) => [view, 0])) as InboxCounts;

/** What `firm_inbox` answers: the ids of the list in its order, how many the list holds, and every view's count. */
export type InboxPage = { ids: string[]; total: number; counts: InboxCounts };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const countOf = (value: unknown): number => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
};

/** The database's answer as the screen reads it; anything else is a read that failed (null), never an empty list. */
export function inboxPageOf(data: unknown): InboxPage | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as { ids?: unknown; total?: unknown; counts?: unknown };
  if (!Array.isArray(raw.ids) || !raw.counts || typeof raw.counts !== "object") return null;
  const counts = raw.counts as Record<string, unknown>;
  return {
    ids: raw.ids.filter((id): id is string => typeof id === "string" && UUID.test(id)),
    total: countOf(raw.total),
    counts: Object.fromEntries(INBOX_VIEWS.map((view) => [view, countOf(counts[view])])) as InboxCounts,
  };
}

/** The rows read by id, in the order the database gave the ids; an id whose row could not be read is left out. */
export function inOrder<Row extends { id: string }>(ids: readonly string[], rows: readonly Row[]): Row[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is Row => row !== undefined);
}

/** Where a conversation opens: the inbox under the same module, view and order, with the conversation chosen. */
export function conversationHref(
  id: string,
  query: { view: InboxView; sort: InboxSort; module: string | null },
): string {
  const params = new URLSearchParams({ c: id });
  if (query.view !== "todas") params.set("ver", query.view);
  const order = SORT_PARAM[query.sort];
  if (order) params.set("ordem", order);
  if (query.module) params.set("modulo", query.module);
  return `/atendimento?${params.toString()}`;
}

/** The inbox under a view and an order, with no conversation chosen (what the bar and the cards lead to). */
export function inboxHref(query: { view: InboxView; sort: InboxSort; module: string | null }): string {
  const params = new URLSearchParams();
  if (query.view !== "todas") params.set("ver", query.view);
  const order = SORT_PARAM[query.sort];
  if (order) params.set("ordem", order);
  if (query.module) params.set("modulo", query.module);
  const search = params.toString();
  return search ? `/atendimento?${search}` : "/atendimento";
}
