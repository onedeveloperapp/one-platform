import { type CaseStatus, type Incident, isCaseStatus, isIncident, type StatusGroup } from "@/lib/cases/cases";

/**
 * The firm's cases as its list reads them (migration 0033, `firm_cases`): a
 * page at a time, counted, filtered and searched in the database, so a firm
 * with thousands of cases reads the same list as one with ten. Pure: what
 * the list asks, and what the database's answer is once it is read.
 */

/** What the list filters by: a group of stages, or what waits for the firm. */
export type CaseFilter =
  | StatusGroup
  | "documentos"
  | "cliente-terminou"
  | "cronologia"
  | "reclamacao"
  | "pecas"
  | "andamento"
  | "vara-civel";

export const CASE_FILTERS: readonly CaseFilter[] = [
  "open",
  "preparing",
  "filed",
  "ended",
  "documentos",
  "cliente-terminou",
  "cronologia",
  "reclamacao",
  "pecas",
  "andamento",
  "vara-civel",
];

export const isCaseFilter = (value: unknown): value is CaseFilter =>
  (CASE_FILTERS as readonly unknown[]).includes(value);

/** One case as the list shows it. */
export type CaseListRow = {
  id: string;
  seq: number;
  /** The first adult claimant, or the guardian when the claimants are minors. */
  client: string;
  incident: Incident;
  /** The airline's IATA designator: the screen has its name. */
  airline: string | null;
  flightDate: string | null;
  status: CaseStatus;
  updatedAt: string;
  /** Files added to the case that nobody of the firm accepted or refused yet. */
  toReview: number;
  /** The client said, on their link, that they sent everything. */
  clientFinished: boolean;
  /** A client said the chronology of what they told is wrong, and nobody asked for another yet. */
  chronologyContested: boolean;
  /** A complaint of the case passed the day its answer was due and still waits. */
  complaintOverdue: boolean;
  /** A piece of the case waits for a lawyer on it: a text outside the queue, one the AI could not write, or a PDF not made. */
  pieceWaiting: boolean;
  /** A lawsuit of the case moved and nobody of the firm said they saw it, or its reading of the court was given up. */
  courtMoved: boolean;
  /** A claimant of a lawsuit planned in the civil court said no to it (0025): the filing waits on the firm. */
  civilRefused: boolean;
};

/** How many cases the firm has under each filter, in all, and still going. */
export type CaseCounts = Record<CaseFilter | "all" | "going", number>;

export type CaseListPage = {
  rows: CaseListRow[];
  /** How many cases match what was asked, on every page. */
  total: number;
  counts: CaseCounts;
};

/** The sizes of a page the list offers; the database serves no more than the largest. */
export const PAGE_SIZES: readonly number[] = [25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
/** The longest search the database reads. */
export const MOST_SEARCH = 120;

/** What the list asks of the database. */
export type CaseListQuery = {
  filter: CaseFilter | null;
  search: string;
  /** The page, from zero. */
  page: number;
  pageSize: number;
};

/** A query from whatever was handed: a server action is a public endpoint. */
export function caseListQuery(input: unknown): CaseListQuery {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const whole = (raw: unknown) => (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0);
  return {
    filter: isCaseFilter(value.filter) ? value.filter : null,
    search: typeof value.search === "string" ? value.search.trim().slice(0, MOST_SEARCH) : "",
    page: Math.min(whole(value.page), 100_000),
    pageSize: PAGE_SIZES.includes(whole(value.pageSize)) ? whole(value.pageSize) : DEFAULT_PAGE_SIZE,
  };
}

const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/**
 * The answer of `firm_cases` as the list reads it; null when it is not one. A case whose stage or incident
 * this code does not know is left out of the page (a newer database), never shown as something else.
 */
export function caseListOf(raw: unknown): CaseListPage | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (!Array.isArray(answer.rows) || typeof answer.counts !== "object" || answer.counts === null) return null;
  const counted = answer.counts as Record<string, unknown>;
  const counts = Object.fromEntries(
    (["all", "going", ...CASE_FILTERS] as const).map((key) => [key, count(counted[key])]),
  ) as CaseCounts;
  const rows = (answer.rows as unknown[]).flatMap((item): CaseListRow[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.seq !== "number") return [];
    if (!isIncident(row.incident) || !isCaseStatus(row.status)) return [];
    return [
      {
        id: row.id,
        seq: row.seq,
        client: typeof row.client === "string" ? row.client : "",
        incident: row.incident,
        airline: typeof row.airline_iata === "string" ? row.airline_iata : null,
        flightDate: typeof row.flight_date === "string" ? row.flight_date : null,
        status: row.status,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
        toReview: count(row.to_review),
        clientFinished: row.client_finished === true,
        chronologyContested: row.chronology_contested === true,
        complaintOverdue: row.complaint_overdue === true,
        pieceWaiting: row.piece_waiting === true,
        courtMoved: row.court_moved === true,
        civilRefused: row.civil_refused === true,
      },
    ];
  });
  return { rows, total: count(answer.total), counts };
}

/** How many cases a tile says: the ones under its filter. */
export const countOf = (counts: CaseCounts, filter: CaseFilter): number => counts[filter];

/** The last page a list of `total` cases has, from zero. */
export const lastPage = (total: number, pageSize: number): number =>
  Math.max(0, Math.ceil(total / Math.max(1, pageSize)) - 1);
