import type {
  CalendarDay,
  CalendarYear,
  DeadlineAssumption,
  DeadlineCounting,
  DeadlineInput,
  DeadlineResult,
  DeadlineSkip,
  DeadlineSkipReason,
  DeadlineTrigger,
} from "@flyee/rules/deadlines";
import { CALENDAR_DAY_KINDS, DEADLINE_COUNTINGS, DEADLINE_TRIGGERS } from "@flyee/rules/deadlines";

/**
 * The pure rules of the firm's deadlines on the screens (migration 0034):
 * the lists, the states and the words of each stored value, what the
 * backend's count is read as (`readCount`), and the input the rule takes
 * from what the database answers (`countInput`). The count itself is
 * `@flyee/rules/deadlines`; nothing here decides a day.
 */

export const DEADLINE_STATUSES = ["proposed", "confirmed", "done", "dismissed"] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];
export const isDeadlineStatus = (value: unknown): value is DeadlineStatus =>
  (DEADLINE_STATUSES as readonly unknown[]).includes(value);

/** The lists of `/prazos`, in the order the screen shows them (`firm_deadlines`). */
export const DEADLINE_VIEWS = ["confirmar", "proximos", "vencidos", "rever", "concluidos"] as const;
export type DeadlineView = (typeof DEADLINE_VIEWS)[number];
export const isDeadlineView = (value: unknown): value is DeadlineView =>
  (DEADLINE_VIEWS as readonly unknown[]).includes(value);

/** How many deadlines a page of a list shows. */
export const DEADLINES_SHOWN = 25;

/** The address of a list and its page: the first list and the first page say nothing. */
export function deadlinesAddress(view: DeadlineView, page: number, module: string | null = null): string {
  const query = new URLSearchParams();
  if (view !== "confirmar") query.set("ver", view);
  if (page > 0) query.set("pagina", String(page + 1));
  // Under a module (0078), every list and page of it stays under the module.
  if (module) query.set("modulo", module);
  const text = query.toString();
  return text ? `/prazos?${text}` : "/prazos";
}

/** The last page of a list of this many, from 0. */
export const lastDeadlinePage = (total: number): number => Math.max(Math.ceil(total / DEADLINES_SHOWN) - 1, 0);

export const isDeadlineCounting = (value: unknown): value is DeadlineCounting =>
  (DEADLINE_COUNTINGS as readonly unknown[]).includes(value);
export const isDeadlineTrigger = (value: unknown): value is DeadlineTrigger =>
  (DEADLINE_TRIGGERS as readonly unknown[]).includes(value);

export const VIEW_KEY: Record<DeadlineView, { label: string; hint: string; emptyTitle: string; emptyBody: string }> = {
  confirmar: {
    label: "deadlines-view-confirm",
    hint: "deadlines-view-confirm-hint",
    emptyTitle: "deadlines-empty-confirm-title",
    emptyBody: "deadlines-empty-confirm-body",
  },
  proximos: {
    label: "deadlines-view-next",
    hint: "deadlines-view-next-hint",
    emptyTitle: "deadlines-empty-next-title",
    emptyBody: "deadlines-empty-next-body",
  },
  vencidos: {
    label: "deadlines-view-overdue",
    hint: "deadlines-view-overdue-hint",
    emptyTitle: "deadlines-empty-overdue-title",
    emptyBody: "deadlines-empty-overdue-body",
  },
  rever: {
    label: "deadlines-view-review",
    hint: "deadlines-view-review-hint",
    emptyTitle: "deadlines-empty-review-title",
    emptyBody: "deadlines-empty-review-body",
  },
  concluidos: {
    label: "deadlines-view-closed",
    hint: "deadlines-view-closed-hint",
    emptyTitle: "deadlines-empty-closed-title",
    emptyBody: "deadlines-empty-closed-body",
  },
};

export const STATUS_KEY: Record<DeadlineStatus, string> = {
  proposed: "deadline-status-proposed",
  confirmed: "deadline-status-confirmed",
  done: "deadline-status-done",
  dismissed: "deadline-status-dismissed",
};

export const COUNTING_KEY: Record<DeadlineCounting, string> = {
  business: "deadline-counting-business",
  calendar: "deadline-counting-calendar",
};

export const TRIGGER_KEY: Record<DeadlineTrigger, string> = {
  publication: "deadline-trigger-publication",
  day: "deadline-trigger-day",
};

export const SKIP_KEY: Record<DeadlineSkipReason, string> = {
  suspension: "deadline-skip-suspension",
  court_suspension: "deadline-skip-court-suspension",
  closed: "deadline-skip-closed",
  holiday: "deadline-skip-holiday",
  partial: "deadline-skip-partial",
};

export const ASSUMPTION_KEY: Record<DeadlineAssumption["code"], string> = {
  calendar_unchecked: "deadline-assumption-calendar-unchecked",
  comarca_unknown: "deadline-assumption-comarca-unknown",
  local_days_unchecked: "deadline-assumption-local-days-unchecked",
  scope_unknown: "deadline-assumption-scope-unknown",
  partial_start: "deadline-assumption-partial-start",
  start_not_business: "deadline-assumption-start-not-business",
  djen_before_rule: "deadline-assumption-djen-before-rule",
  portal_first: "deadline-assumption-portal-first",
  calendar_suspension: "deadline-assumption-calendar-suspension",
};

/** Why somebody should look at an open deadline again (`deadline_review_reasons`). */
export const DEADLINE_REVIEW_REASONS = ["publication_cancelled", "count_changed", "count_failed"] as const;
export type DeadlineReviewReason = (typeof DEADLINE_REVIEW_REASONS)[number];
export const isDeadlineReviewReason = (value: unknown): value is DeadlineReviewReason =>
  (DEADLINE_REVIEW_REASONS as readonly unknown[]).includes(value);

/** What a refusal of the database or of an action is called on the screen. */
const ERROR_KEY: Record<string, string> = {
  not_found: "deadline-error-not-found",
  not_allowed: "deadline-error-not-allowed",
  not_allowed_in_support_session: "deadline-error-support",
  cancelled: "deadline-error-cancelled",
  not_filed: "deadline-error-not-filed",
  court_unknown: "deadline-error-court-unknown",
  too_many: "deadline-error-too-many",
  closed: "deadline-error-closed",
  open: "deadline-error-open",
  changed: "deadline-error-changed",
  counting: "deadline-error-counting",
  reason_required: "deadline-error-reason",
  invalid_data: "deadline-error-invalid",
  invalid_day: "deadline-error-invalid-day",
  invalid_days: "deadline-error-invalid-days",
  too_long: "deadline-error-too-long",
  not_linkable: "deadline-error-not-linkable",
};

export const deadlineErrorKey = (code: string | null | undefined): string =>
  ERROR_KEY[code ?? ""] ?? "deadline-error-failed";

/** What a field the database named is called, for the message beside it. */
export const DEADLINE_FIELDS = [
  "title",
  "act",
  "trigger",
  "trigger_on",
  "days",
  "counting",
  "due_on",
  "portal_on",
  "reason",
  "note",
] as const;
export type DeadlineField = (typeof DEADLINE_FIELDS)[number];
export const isDeadlineField = (value: unknown): value is DeadlineField =>
  (DEADLINE_FIELDS as readonly unknown[]).includes(value);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value);
const isText = (value: unknown, most: number): value is string => typeof value === "string" && value.length <= most;
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const SKIP_REASONS: readonly DeadlineSkipReason[] = ["suspension", "court_suspension", "closed", "holiday", "partial"];

function readSkip(value: unknown): DeadlineSkip[] {
  if (typeof value !== "object" || value === null) return [];
  const { from, to, reason, label } = value as Record<string, unknown>;
  if (!isDay(from) || !isDay(to) || !(SKIP_REASONS as readonly unknown[]).includes(reason)) return [];
  return [{ from, to, reason: reason as DeadlineSkipReason, label: isText(label, 200) ? label : "" }];
}

function readAssumption(value: unknown): DeadlineAssumption[] {
  if (typeof value !== "object" || value === null) return [];
  const item = value as Record<string, unknown>;
  const years = asList(item.years).filter((year): year is number => Number.isInteger(year));
  const days = asList(item.days).filter(isDay);
  switch (item.code) {
    case "calendar_unchecked":
      return [{ code: "calendar_unchecked", years }];
    case "local_days_unchecked":
      return [{ code: "local_days_unchecked", years }];
    case "comarca_unknown":
      return [{ code: "comarca_unknown" }];
    case "djen_before_rule":
      return [{ code: "djen_before_rule" }];
    case "portal_first":
      return isDay(item.day) ? [{ code: "portal_first", day: item.day }] : [];
    case "calendar_suspension":
      return [{ code: "calendar_suspension" }];
    case "scope_unknown":
      return item.what === "proceeding_kind" || item.what === "system"
        ? [{ code: "scope_unknown", what: item.what, days }]
        : [];
    case "partial_start":
      return isDay(item.day)
        ? [{ code: "partial_start", day: item.day, label: isText(item.label, 200) ? item.label : "" }]
        : [];
    case "start_not_business":
      return isDay(item.day) ? [{ code: "start_not_business", day: item.day }] : [];
    default:
      return [];
  }
}

/** The checked years of a court's calendar, each with the day it was checked, as a count or a list says them. */
export function readCheckedYears(value: unknown): { year: number; checkedOn: string | null }[] {
  return asList(value).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { year, checkedOn, checked_on: checkedOnRow } = item as Record<string, unknown>;
    if (!Number.isInteger(year)) return [];
    const on = checkedOn ?? checkedOnRow;
    return [{ year: year as number, checkedOn: isDay(on) ? on : null }];
  });
}

/**
 * What the backend's count of a deadline says, as the screen shows it: read
 * as nothing more than it may be. Null when it is not a count.
 */
export function readCount(value: unknown): DeadlineResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const count = value as Record<string, unknown>;
  if (
    typeof count.rule !== "string" ||
    !isDeadlineTrigger(count.trigger) ||
    !isDeadlineCounting(count.counting) ||
    !isDay(count.triggerDay) ||
    !isDay(count.startsOn) ||
    !isDay(count.dueOn) ||
    !Number.isInteger(count.days)
  ) {
    return null;
  }
  const moved = count.moved as Record<string, unknown> | null | undefined;
  return {
    rule: count.rule as DeadlineResult["rule"],
    trigger: count.trigger,
    triggerDay: count.triggerDay,
    publishedOn: isDay(count.publishedOn) ? count.publishedOn : null,
    fromDay: isDay(count.fromDay) ? count.fromDay : count.triggerDay,
    startsOn: count.startsOn,
    countedDueOn: isDay(count.countedDueOn) ? count.countedDueOn : count.dueOn,
    dueOn: count.dueOn,
    days: count.days as number,
    counting: count.counting,
    skipped: asList(count.skipped).flatMap(readSkip),
    moved:
      moved && isDay(moved.from) && isDay(moved.to) && (moved.reason === "partial" || moved.reason === "not_business")
        ? { from: moved.from, to: moved.to, reason: moved.reason, label: isText(moved.label, 200) ? moved.label : "" }
        : null,
    assumptions: asList(count.assumptions).flatMap(readAssumption),
    checkedYears: readCheckedYears(count.checkedYears),
  };
}

/** A year of a court's calendar as the database answers it (`court_calendar`). */
export type CalendarYearRow = {
  year: number;
  all_comarcas: boolean;
  comarcas: string[] | null;
  checked_on?: string | null;
};
/** A day of a court's calendar as the database answers it (`court_calendar`). */
export type CalendarDayRow = {
  day: string;
  kind: string;
  label: string;
  proceeding_kinds: string[] | null;
  systems: string[] | null;
  comarcas: string[] | null;
};

/** What the count of a deadline reads, as `deadline_to_count` answers it. */
export type DeadlineToCount = {
  id: string;
  org_id: string;
  claim: number;
  revision: number;
  trigger: string;
  trigger_on: string;
  days: number;
  counting: string;
  /** The day the same act was intimated in the court's own system, when a person gave it (0144). */
  portal_on?: string | null;
  court: string;
  place: { proceeding_kind: string | null; system: string | null; comarca: string | null } | null;
  years: CalendarYearRow[] | null;
  days_off: CalendarDayRow[] | null;
};

/** A court's calendar, from its rows, as the rule takes it. */
export function calendarOf(years: readonly CalendarYearRow[], days: readonly CalendarDayRow[]) {
  return {
    years: years.map(
      (year): CalendarYear => ({
        year: year.year,
        allComarcas: Boolean(year.all_comarcas),
        comarcas: year.comarcas ?? [],
        checkedOn: isDay(year.checked_on) ? year.checked_on : null,
      }),
    ),
    days: days.flatMap((day): CalendarDay[] =>
      (CALENDAR_DAY_KINDS as readonly string[]).includes(day.kind)
        ? [
            {
              day: day.day,
              kind: day.kind as CalendarDay["kind"],
              label: day.label,
              proceedingKinds: day.proceeding_kinds ?? [],
              systems: day.systems ?? [],
              comarcas: day.comarcas ?? [],
            },
          ]
        : [],
    ),
  };
}

/**
 * The input of the rule for a deadline the database handed over. Null when
 * what it holds is not something the rule counts (a trigger or a counting it
 * does not know): the count is then refused, never guessed.
 */
export function countInput(read: DeadlineToCount): DeadlineInput | null {
  if (!isDeadlineTrigger(read.trigger) || !isDeadlineCounting(read.counting)) return null;
  return {
    trigger: read.trigger,
    on: read.trigger_on,
    days: read.days,
    counting: read.counting,
    portalOn: isDay(read.portal_on) ? read.portal_on : null,
    place: {
      proceedingKind: read.place?.proceeding_kind ?? null,
      system: read.place?.system ?? null,
      comarca: read.place?.comarca ?? null,
    },
    calendar: calendarOf(read.years ?? [], read.days_off ?? []),
  };
}

/**
 * The day an open deadline is urgent by (`deadline_urgent_on`, migration
 * 0034): its own, but for a confirmed one whose count in force gives another
 * day than the one it was confirmed against, the earlier of the two. For a
 * screen that reads the deadline's columns itself.
 */
export function deadlineUrgentOn(row: {
  status: string;
  dueOn: string | null;
  computedDueOn: string | null;
  computedRevision: number | null;
  revision: number;
  confirmedAgainst: string | null;
}): string | null {
  const changed =
    row.status === "confirmed" &&
    row.computedRevision === row.revision &&
    row.computedDueOn !== (row.confirmedAgainst ?? row.dueOn);
  if (!changed || row.computedDueOn === null) return row.dueOn;
  if (row.dueOn === null) return row.computedDueOn;
  return row.computedDueOn < row.dueOn ? row.computedDueOn : row.dueOn;
}

/** Whole days from one day to the other: how far a deadline is, from today. */
export function daysBetween(from: string, to: string): number {
  const at = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** The day of the week of a day, as people in Brazil say it: "quarta-feira". */
export function weekdayOf(day: string): string {
  return new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
}

/** A day's date in Brasília: what "today" is for a deadline. */
export function todayInBrasilia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}
