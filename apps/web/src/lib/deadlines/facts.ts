import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import {
  type CalendarDayRow,
  type CalendarYearRow,
  DEADLINE_VIEWS,
  type DeadlineReviewReason,
  DEADLINES_SHOWN,
  type DeadlineStatus,
  deadlineUrgentOn,
  type DeadlineView,
  isDeadlineCounting,
  isDeadlineReviewReason,
  isDeadlineStatus,
  isDeadlineTrigger,
  readCheckedYears,
  readCount,
} from "@/lib/deadlines/deadlines";
import { readingsOf, type ShownReading, shownReading } from "@/lib/publications/reading-words";
import { formatCnj } from "@flyee/rules/cnj";
import {
  type DeadlineCounting,
  type DeadlineResult,
  type DeadlineTrigger,
  internalDeadline,
} from "@flyee/rules/deadlines";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screens read of the firm's deadlines (migration 0034), under the
 * person's own session: the lists of `/prazos` (`firm_deadlines`, which
 * counts each of them), a case's own, the open ones of some publications,
 * the acts of the list and a court's calendar for a count shown before it
 * is proposed. Colleagues are named by `firm_team`; a moment is written on
 * the reader's own clock.
 */

export type DeadlineRow = {
  id: string;
  title: string;
  act: string | null;
  status: DeadlineStatus;
  /** The day the firm works with: the counted one while proposed, the confirmed one after. */
  dueOn: string | null;
  /** The day it is urgent by: its own, or an earlier one the count in force gives after it was confirmed. */
  urgentOn: string | null;
  computedDueOn: string | null;
  corrected: boolean;
  correctionReason: string | null;
  confirmedAgainst: string | null;
  trigger: DeadlineTrigger;
  triggerOn: string;
  days: number;
  counting: DeadlineCounting;
  /** What the rule counted, as it said it; null while it is being counted, or when it could not be. */
  count: DeadlineResult | null;
  /** The checked years of the court's calendar the count goes through, with the day each was last checked. */
  calendarChecked: { year: number; checkedOn: string | null }[];
  revision: number;
  /** The count is of the revision in force. */
  counted: boolean;
  /** It could not be counted, for good: a person confirms a day of their own. */
  countFailed: boolean;
  overdue: boolean;
  /** Somebody should look at it again, and why (`deadline_review_reasons`). */
  review: boolean;
  reviewReasons: DeadlineReviewReason[];
  cnj: string;
  court: string;
  caseId: string | null;
  caseSeq: number | null;
  proceedingId: string | null;
  proceedingKind: string | null;
  publicationId: string | null;
  /** False when the court cancelled the publication it came from. */
  publicationActive: boolean | null;
  /** The day the DJEN made that publication available. */
  publicationAvailableOn: string | null;
  confirmedBy: string | null;
  confirmedLabel: string | null;
  /** Confirmed by ONE on the day counted, where the firm lets it (0016, `deadline_confirm`). */
  confirmedAuto: boolean;
  doneBy: string | null;
  doneLabel: string | null;
  doneNote: string | null;
  dismissedBy: string | null;
  dismissedLabel: string | null;
  dismissReason: string | null;
  createdBy: string | null;
  createdLabel: string | null;
  /** Proposed by ONE from the publication it read, where the firm lets it (0040, `publication_deadline`). */
  proposedAuto: boolean;
  /** The internal deadline the firm works to, some business days before the fatal one (0132); null when off. */
  internalOn?: string | null;
};

export type DeadlinesData = {
  /** Brasília's today, as the database read it. */
  today: string;
  /** Within how many days a deadline is due soon: the days the home counts by. */
  soonDays: number;
  /** Of the open deadlines, the ones due within those days: what the home counts as due soon. */
  soonCount: number;
  counts: Record<DeadlineView, number>;
  total: number;
  rows: DeadlineRow[];
  page: number;
  more: boolean;
};

type RawRow = {
  id: string;
  title: string;
  act: string | null;
  status: string;
  due_on: string | null;
  urgent_on: string | null;
  computed_due_on: string | null;
  corrected: boolean;
  correction_reason: string | null;
  confirmed_against: string | null;
  trigger: string;
  trigger_on: string;
  days: number;
  counting: string;
  explanation: unknown;
  calendar_checked: unknown;
  revision: number;
  counted: boolean;
  count_failed: boolean;
  overdue: boolean;
  review: boolean;
  review_reasons: unknown;
  cnj: string;
  court: string;
  case_id: string | null;
  case_seq: number | null;
  proceeding_id: string | null;
  proceeding_kind: string | null;
  publication_id: string | null;
  publication_active: boolean | null;
  publication_available_on: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmed_auto?: boolean | null;
  done_by: string | null;
  done_at: string | null;
  done_note: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  dismiss_reason: string | null;
  created_by: string | null;
  created_at: string | null;
  proposed_auto?: boolean | null;
};

type Answer = {
  today?: string;
  soon_days?: unknown;
  counts?: Record<string, unknown>;
  total?: unknown;
  rows?: RawRow[];
};
type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const nameOf = (person: TeamRow): string => person.display_name?.trim() || person.email?.split("@")[0] || "";

async function teamNames(supabase: SupabaseClient, firmId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("firm_team", { target_org: firmId });
  if (error) throw new Error("the team could not be read");
  return new Map(((data ?? []) as TeamRow[]).map((person) => [person.user_id, nameOf(person)]));
}

function toRow(raw: RawRow, names: Map<string, string>, timeZone: string | null | undefined): DeadlineRow | null {
  if (!isDeadlineStatus(raw.status) || !isDeadlineTrigger(raw.trigger) || !isDeadlineCounting(raw.counting))
    return null;
  const who = (id: string | null) => (id ? names.get(id) || null : null);
  const when = (at: string | null) => (at ? momentLabel(at, timeZone) : null);
  return {
    id: raw.id,
    title: raw.title,
    act: raw.act,
    status: raw.status,
    dueOn: raw.due_on,
    urgentOn: raw.urgent_on ?? null,
    computedDueOn: raw.computed_due_on,
    corrected: Boolean(raw.corrected),
    correctionReason: raw.correction_reason,
    confirmedAgainst: raw.confirmed_against,
    trigger: raw.trigger,
    triggerOn: raw.trigger_on,
    days: raw.days,
    counting: raw.counting,
    count: raw.counted ? readCount(raw.explanation) : null,
    calendarChecked: readCheckedYears(raw.calendar_checked),
    revision: raw.revision,
    counted: Boolean(raw.counted),
    countFailed: Boolean(raw.count_failed),
    overdue: Boolean(raw.overdue),
    review: Boolean(raw.review),
    reviewReasons: (Array.isArray(raw.review_reasons) ? raw.review_reasons : []).filter(isDeadlineReviewReason),
    cnj: formatCnj(raw.cnj) ?? raw.cnj,
    court: raw.court,
    caseId: raw.case_id,
    caseSeq: raw.case_seq,
    proceedingId: raw.proceeding_id,
    proceedingKind: raw.proceeding_kind,
    publicationId: raw.publication_id,
    publicationActive: raw.publication_active,
    publicationAvailableOn: raw.publication_available_on,
    confirmedBy: who(raw.confirmed_by),
    confirmedLabel: when(raw.confirmed_at),
    confirmedAuto: raw.confirmed_auto === true,
    doneBy: who(raw.done_by),
    doneLabel: when(raw.done_at),
    doneNote: raw.done_note,
    dismissedBy: who(raw.dismissed_by),
    dismissedLabel: when(raw.dismissed_at),
    dismissReason: raw.dismiss_reason,
    createdBy: who(raw.created_by),
    createdLabel: when(raw.created_at),
    proposedAuto: raw.proposed_auto === true,
  };
}

const countOf = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

/** The setting's days, or the default when the answer has none. */
const soonOf = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 60 ? value : 3;

async function firmDeadlines(
  supabase: SupabaseClient,
  firmId: string,
  view: DeadlineView | "abertos",
  limit: number,
  offset: number,
  caseId: string | null,
  module: string | null = null,
): Promise<Answer> {
  const { data, error } = await supabase.rpc("firm_deadlines", {
    target_org: firmId,
    target_view: view,
    target_limit: limit,
    target_offset: offset,
    target_case: caseId,
    target_module: module,
  });
  if (error || typeof data !== "object" || data === null) throw new Error("the deadlines could not be read");
  return data as Answer;
}

/** A page of one of the lists of `/prazos`, with the count of each. */
/**
 * How many of the court's business days before the fatal deadline the firm's internal one comes (0132): zero when it
 * switched it off, or when it cannot be read (nothing is said then, rather than a wrong day).
 */
export async function firmInternalDays(supabase: SupabaseClient, firmId: string): Promise<number> {
  const { data, error } = await supabase
    .from("organizations")
    .select("internal_deadline_days")
    .eq("id", firmId)
    .maybeSingle();
  if (error || !data) return 0;
  const days = (data as { internal_deadline_days?: unknown }).internal_deadline_days;
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : 0;
}

/** Each open deadline with its internal day, by the firm's days. */
function withInternal(rows: DeadlineRow[], days: number): DeadlineRow[] {
  return rows.map((row) => {
    const open = row.status === "proposed" || row.status === "confirmed";
    const first = row.count?.startsOn ?? null;
    return {
      ...row,
      internalOn:
        open && row.dueOn && first && days > 0
          ? internalDeadline({ dueOn: row.dueOn, startsOn: first, skipped: row.count?.skipped ?? [] }, days)
          : null,
    };
  });
}

export async function loadDeadlines(
  supabase: SupabaseClient,
  firmId: string,
  view: DeadlineView,
  page: number,
  timeZone: string | null | undefined,
  module: string | null = null,
): Promise<DeadlinesData> {
  const [answer, names, internalDays] = await Promise.all([
    firmDeadlines(supabase, firmId, view, DEADLINES_SHOWN, page * DEADLINES_SHOWN, null, module),
    teamNames(supabase, firmId),
    firmInternalDays(supabase, firmId),
  ]);
  const counts = Object.fromEntries(DEADLINE_VIEWS.map((name) => [name, countOf(answer.counts?.[name])])) as Record<
    DeadlineView,
    number
  >;
  const total = countOf(answer.total);
  return {
    today: String(answer.today ?? ""),
    soonDays: soonOf(answer.soon_days),
    soonCount: countOf(answer.counts?.em_breve),
    counts,
    total,
    rows: withInternal(
      (answer.rows ?? []).flatMap((raw) => toRow(raw, names, timeZone) ?? []),
      internalDays,
    ),
    page,
    more: (page + 1) * DEADLINES_SHOWN < total,
  };
}

/** How many closed deadlines a case shows: the latest. */
const CLOSED_SHOWN = 5;

export type CaseDeadlines = {
  today: string;
  soonDays: number;
  open: DeadlineRow[];
  closed: DeadlineRow[];
  closedCount: number;
};

/** A case's own deadlines: every open one, the nearest first, and the latest closed. */
export async function caseDeadlines(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  timeZone: string | null | undefined,
): Promise<CaseDeadlines> {
  const [open, closed, names, internalDays] = await Promise.all([
    firmDeadlines(supabase, firmId, "abertos", 100, 0, caseId),
    firmDeadlines(supabase, firmId, "concluidos", CLOSED_SHOWN, 0, caseId),
    teamNames(supabase, firmId),
    firmInternalDays(supabase, firmId),
  ]);
  return {
    today: String(open.today ?? ""),
    soonDays: soonOf(open.soon_days),
    open: withInternal(
      (open.rows ?? []).flatMap((raw) => toRow(raw, names, timeZone) ?? []),
      internalDays,
    ),
    closed: (closed.rows ?? []).flatMap((raw) => toRow(raw, names, timeZone) ?? []),
    closedCount: countOf(closed.counts?.concluidos),
  };
}

/** An open deadline of a publication, as its card says it: by the day it is urgent by. */
export type PublicationDeadline = {
  id: string;
  title: string;
  status: "proposed" | "confirmed";
  dueOn: string | null;
  urgentOn: string | null;
  /** Proposed by ONE from the publication (0040). */
  auto: boolean;
};

/** The open deadlines of some publications, by publication. */
export async function publicationDeadlines(
  supabase: SupabaseClient,
  firmId: string,
  publicationIds: readonly string[],
): Promise<Map<string, PublicationDeadline[]>> {
  const found = new Map<string, PublicationDeadline[]>();
  if (publicationIds.length === 0) return found;
  const { data, error } = await supabase
    .from("deadlines")
    .select(
      "id, publication_id, title, status, due_on, computed_due_on, computed_revision, revision, confirmed_against, proposed_auto",
    )
    .eq("org_id", firmId)
    .in("publication_id", [...publicationIds])
    .in("status", ["proposed", "confirmed"])
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) throw new Error("the deadlines of the publications could not be read");
  for (const row of (data ?? []) as {
    id: string;
    publication_id: string;
    title: string;
    status: "proposed" | "confirmed";
    due_on: string | null;
    computed_due_on: string | null;
    computed_revision: number | null;
    revision: number;
    confirmed_against: string | null;
    proposed_auto: boolean | null;
  }[]) {
    const list = found.get(row.publication_id) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      status: row.status,
      dueOn: row.due_on,
      urgentOn: deadlineUrgentOn({
        status: row.status,
        dueOn: row.due_on,
        computedDueOn: row.computed_due_on,
        computedRevision: row.computed_revision,
        revision: row.revision,
        confirmedAgainst: row.confirmed_against,
      }),
      auto: row.proposed_auto === true,
    });
    found.set(row.publication_id, list);
  }
  return found;
}

/** A publication triaged as a deadline that no deadline came from, as `/prazos` shows it. */
export type PublicationWithoutDeadline = {
  id: string;
  cnj: string;
  court: string;
  availableOn: string;
  kind: string;
  /** The start of its text, never the whole of it. */
  head: string;
  caseId: string | null;
  caseSeq: number | null;
  proceedingKind: string | null;
  triagedBy: string | null;
  triagedLabel: string | null;
  /** The deadlines of its lawsuit that came from no publication: one may be its own, recorded from the court's system. */
  lawsuitDeadlines: { id: string; title: string; status: string; dueOn: string | null }[];
  /** What ONE read of it, when the firm lets ONE read terms (0040): left to a person with why, or not read in time. */
  reading: ShownReading | null;
};

export type PublicationsWithoutDeadline = {
  /** For how many days after it was made available such a publication is shown. */
  watchDays: number;
  total: number;
  rows: PublicationWithoutDeadline[];
};

/** The publications of the firm triaged as a deadline, in the last days of the setting, that no deadline came from. */
export async function publicationsWithoutDeadline(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
): Promise<PublicationsWithoutDeadline> {
  const [{ data, error }, names] = await Promise.all([
    supabase.rpc("firm_publications_without_deadline", { target_org: firmId, target_limit: 20 }),
    teamNames(supabase, firmId),
  ]);
  if (error || typeof data !== "object" || data === null)
    throw new Error("the publications without a deadline could not be read");
  const answer = data as { watch_days?: unknown; total?: unknown; rows?: Record<string, unknown>[] };
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const listed = (Array.isArray(answer.rows) ? answer.rows : []).flatMap((row) =>
    text(row.id) ? [String(row.id)] : [],
  );
  const readings =
    listed.length > 0
      ? await supabase
          .from("publication_readings")
          .select("publication_id, kind, status, reason")
          .eq("org_id", firmId)
          .eq("kind", "deadline")
          .in("publication_id", listed)
      : { data: [], error: null };
  const read = readingsOf(readings.error ? [] : readings.data);
  return {
    watchDays: countOf(answer.watch_days),
    total: countOf(answer.total),
    rows: (Array.isArray(answer.rows) ? answer.rows : []).flatMap((row) => {
      const id = text(row.id);
      const cnj = text(row.cnj);
      const availableOn = text(row.available_on);
      if (!id || !cnj || !availableOn) return [];
      const triagedBy = text(row.triaged_by);
      const triagedAt = text(row.triaged_at);
      return [
        {
          id,
          cnj: formatCnj(cnj) ?? cnj,
          court: text(row.court) ?? "",
          availableOn,
          kind: text(row.kind) ?? "",
          head: text(row.head) ?? "",
          caseId: text(row.case_id),
          caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
          proceedingKind: text(row.proceeding_kind),
          triagedBy: triagedBy ? names.get(triagedBy) || null : null,
          triagedLabel: triagedAt ? momentLabel(triagedAt, timeZone) : null,
          lawsuitDeadlines: (Array.isArray(row.lawsuit_deadlines) ? row.lawsuit_deadlines : []).flatMap(
            (deadline: Record<string, unknown>) => {
              const deadlineId = text(deadline.id);
              const title = text(deadline.title);
              return deadlineId && title
                ? [{ id: deadlineId, title, status: text(deadline.status) ?? "", dueOn: text(deadline.due_on) }]
                : [];
            },
          ),
          reading: shownReading("prazo", read.get(id) ?? [], null),
        },
      ];
    }),
  };
}

/** An act of the list, as the form offers it. */
export type DeadlineAct = {
  slug: string;
  name: string;
  days: number;
  counting: DeadlineCounting;
  proceedingKinds: string[];
  basis: string;
  /** Offered for a new choice. An act the operator took off the list stays the act of a deadline that has it. */
  active: boolean;
};

/** The acts a term is set for, in the list's order: the ones taken off the list too, for the deadlines that have them. */
export async function deadlineActs(supabase: SupabaseClient): Promise<DeadlineAct[]> {
  const { data, error } = await supabase
    .from("deadline_acts")
    .select("slug, name, days, counting, proceeding_kinds, basis, active")
    .order("position")
    .order("name");
  if (error) throw new Error("the acts could not be read");
  return (
    (data ?? []) as {
      slug: string;
      name: string;
      days: number;
      counting: string;
      proceeding_kinds: string[] | null;
      basis: string;
      active: boolean;
    }[]
  ).flatMap((act) =>
    isDeadlineCounting(act.counting)
      ? [
          {
            slug: act.slug,
            name: act.name,
            days: act.days,
            counting: act.counting,
            proceedingKinds: act.proceeding_kinds ?? [],
            basis: act.basis,
            active: Boolean(act.active),
          },
        ]
      : [],
  );
}

/**
 * A court's calendar for the years a count from that year may go through,
 * read by the same function the backend's count reads (`court_calendar`):
 * the count shown before a deadline is proposed is the one it will get.
 */
export async function courtCalendar(
  supabase: SupabaseClient,
  court: string,
  firstYear: number,
): Promise<{ years: CalendarYearRow[]; days: CalendarDayRow[] }> {
  const { data, error } = await supabase.rpc("court_calendar", { target_court: court, target_first_year: firstYear });
  if (error || typeof data !== "object" || data === null) throw new Error("the court's calendar could not be read");
  const answer = data as { years?: unknown; days_off?: unknown };
  return {
    years: (Array.isArray(answer.years) ? answer.years : []) as CalendarYearRow[],
    days: (Array.isArray(answer.days_off) ? answer.days_off : []) as CalendarDayRow[],
  };
}
