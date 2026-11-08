import { type CaseStatus, isCaseStatus, type StatusGroup } from "@/lib/cases/cases";
import type { CourtMarks } from "@/lib/cases/journey";
import { caseKindLabelKey } from "@/lib/modules/registry";

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
  | "vara-civel"
  | "agencia"
  | "novos-mes"
  | "ajuizados-mes"
  | "encerrados-mes"
  | "arquivados-mes"
  | CourtView
  | StandingView;

/**
 * Who has the case (0111): the firm, the client, ONE, the court, the platform of ONE; and the cases at a step for
 * longer than the setting says of it (`estoque-v1`).
 */
export type StandingView = (typeof STANDING_VIEWS)[number];
export const STANDING_VIEWS = [
  "com-escritorio",
  "com-cliente",
  "com-one",
  "no-tribunal",
  "com-plataforma",
  "estagnados",
] as const;
export const isStandingView = (value: unknown): value is StandingView =>
  (STANDING_VIEWS as readonly unknown[]).includes(value);

/**
 * The court's views (0110): the cases whose lawsuits moved today, in the last 7 and 30 days; the cases in court quiet
 * for more than 30, 45 and 90 days (the last thing a lawsuit ONE read did); and the ones with a lawsuit no source ever
 * read.
 */
export type CourtView = (typeof COURT_VIEWS)[number];
export const COURT_VIEWS = [
  "mov-hoje",
  "mov-7",
  "mov-30",
  "parado-30",
  "parado-45",
  "parado-90",
  "nunca-capturados",
] as const;

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
  "agencia",
  "novos-mes",
  "ajuizados-mes",
  "encerrados-mes",
  "arquivados-mes",
  ...COURT_VIEWS,
  ...STANDING_VIEWS,
];

export const isCaseFilter = (value: unknown): value is CaseFilter =>
  (CASE_FILTERS as readonly unknown[]).includes(value);

/** One case as the list shows it. */
export type CaseListRow = {
  id: string;
  seq: number;
  /** The first adult claimant, or the guardian when the claimants are minors. */
  client: string;
  /** The module the case is of (0068, named on each row since 0078). */
  module: string;
  /** The kind of problem, one of the case's module's (lib/modules/registry.ts); null for a module with none. */
  incident: string | null;
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
  /** The partner agency the case came from (0071, 0075); null for a case of the firm's own. */
  agency: string | null;
  /** When a lawsuit of the case in court last moved (0110); null when none did. */
  movedAt: string | null;
  /** The numbers of its lawsuits in court, 20 digits each (0110). */
  cnjs: string[];
  /** Who has the case and why, as the top of the case says it (0111); null for a case that ended. */
  holder: string | null;
  why: string | null;
  /** The step of its way, since when, how many days (of Brasília) and whether it stagnated (`estoque-v1`). */
  step: string | null;
  stepSince: string | null;
  stepDays: number | null;
  stagnant: boolean;
  /**
   * For a case in court, what its lawsuits show (a hearing held, a decision and a payment published): the step of
   * its way the list shows. Null before the court, or when it could not be read.
   */
  court: CourtMarks | null;
};

/** How many cases the firm has under each filter, in all, and still going. */
export type CaseCounts = Record<CaseFilter | "all" | "going", number>;

/**
 * The numbers of the cards above the list (0108), each beside what it was in the same days of the month before:
 * the cases going now and at the end of the same day of the month before; the ones opened, filed and ended from
 * the first of this month to today, and from the first of the month before to the same day of it. The days are
 * Brasília's, as the database counts them.
 */
export type CaseNumbers = {
  going: number;
  goingBefore: number;
  opened: number;
  openedBefore: number;
  filed: number;
  filedBefore: number;
  ended: number;
  endedBefore: number;
  /** The cases that went to court and ended (0110), the word the market uses beside the ones filed. */
  archived: number;
  archivedBefore: number;
  /** This month so far: its first day and today. */
  since: string;
  until: string;
  /** The same days of the month before. */
  beforeSince: string;
  beforeUntil: string;
};

/** The orders the list offers: the latest change first (the usual one), the oldest change, the newest case, the oldest case. */
export type CaseSort = "recent" | "oldest" | "newest" | "first";
export const CASE_SORTS: readonly CaseSort[] = ["recent", "oldest", "newest", "first"];
export const isCaseSort = (value: unknown): value is CaseSort => (CASE_SORTS as readonly unknown[]).includes(value);

export type CaseListPage = {
  rows: CaseListRow[];
  /** How many cases match what was asked, on every page. */
  total: number;
  counts: CaseCounts;
  /** The numbers of the cards; null when the database did not say them (one before 0108). */
  numbers: CaseNumbers | null;
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
  /** Only the cases of this module (migration 0078), or of every module of the firm. */
  module: string | null;
  /** The page, from zero. */
  page: number;
  pageSize: number;
  /** The order of the list; the latest change first when left out. */
  sort?: CaseSort;
  /** Only the cases of this kind of problem, and of this airline (its IATA code): they narrow every count too. */
  incident?: string | null;
  airline?: string | null;
};

/** A query from whatever was handed: a server action is a public endpoint. */
export function caseListQuery(input: unknown): CaseListQuery {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const whole = (raw: unknown) => (typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : 0);
  return {
    filter: isCaseFilter(value.filter) ? value.filter : null,
    search: typeof value.search === "string" ? value.search.trim().slice(0, MOST_SEARCH) : "",
    // A module's key as the catalog writes it; the database answers only the firm's cases of it either way.
    module: typeof value.module === "string" && /^[a-z][a-z0-9-]{2,40}$/.test(value.module) ? value.module : null,
    page: Math.min(whole(value.page), 100_000),
    pageSize: PAGE_SIZES.includes(whole(value.pageSize)) ? whole(value.pageSize) : DEFAULT_PAGE_SIZE,
    sort: isCaseSort(value.sort) ? value.sort : "recent",
    incident:
      typeof value.incident === "string" && /^[a-z][a-z0-9_-]{1,40}$/.test(value.incident) ? value.incident : null,
    airline:
      typeof value.airline === "string" && /^[A-Za-z0-9]{2,3}$/.test(value.airline)
        ? value.airline.toUpperCase()
        : null,
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
    if (!isCaseStatus(row.status)) return [];
    // A kind no module has is a newer database's: the row stays, said by its module.
    const incident = typeof row.incident === "string" && caseKindLabelKey(row.incident) !== null ? row.incident : null;
    return [
      {
        id: row.id,
        seq: row.seq,
        client: typeof row.client === "string" ? row.client : "",
        module: typeof row.module === "string" && row.module !== "" ? row.module : "",
        incident,
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
        agency: typeof row.agency === "string" && row.agency !== "" ? row.agency : null,
        movedAt: typeof row.moved_at === "string" ? row.moved_at : null,
        cnjs: Array.isArray(row.cnjs) ? row.cnjs.filter((cnj): cnj is string => typeof cnj === "string") : [],
        holder: typeof row.holder === "string" ? row.holder : null,
        why: typeof row.why === "string" ? row.why : null,
        step: typeof row.step === "string" ? row.step : null,
        stepSince: typeof row.step_since === "string" ? row.step_since : null,
        stepDays: typeof row.step_days === "number" && Number.isFinite(row.step_days) ? row.step_days : null,
        stagnant: row.stagnant === true,
        court: courtMarksOf(row.court),
      },
    ];
  });
  return { rows, total: count(answer.total), counts, numbers: caseNumbersOf(answer.numbers) };
}

/** What a case's lawsuits show in court, as the row carries it (0110); null for a case out of court. */
function courtMarksOf(raw: unknown): CourtMarks | null {
  if (typeof raw !== "object" || raw === null) return null;
  const marks = raw as Record<string, unknown>;
  return { held: marks.held === true, decided: marks.decided === true, paid: marks.paid === true };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The numbers of the cards as the database said them; null when they are not whole. */
export function caseNumbersOf(raw: unknown): CaseNumbers | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const days = [value.since, value.until, value.before_since, value.before_until];
  if (!days.every((day) => typeof day === "string" && DAY.test(day))) return null;
  return {
    going: count(value.going),
    goingBefore: count(value.going_before),
    opened: count(value.new),
    openedBefore: count(value.new_before),
    filed: count(value.filed),
    filedBefore: count(value.filed_before),
    ended: count(value.ended),
    endedBefore: count(value.ended_before),
    archived: count(value.archived),
    archivedBefore: count(value.archived_before),
    since: value.since as string,
    until: value.until as string,
    beforeSince: value.before_since as string,
    beforeUntil: value.before_until as string,
  };
}

/** How many cases a tile says: the ones under its filter. */
export const countOf = (counts: CaseCounts, filter: CaseFilter): number => counts[filter];

/** The last page a list of `total` cases has, from zero. */
export const lastPage = (total: number, pageSize: number): number =>
  Math.max(0, Math.ceil(total / Math.max(1, pageSize)) - 1);
