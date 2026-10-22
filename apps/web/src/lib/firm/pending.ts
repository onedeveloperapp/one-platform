import { waitingFix, waitingKey } from "@/lib/cases/advance";
import { type FirmToday, type TodayNeed, todayNeeds, type TodayViewer } from "@/lib/firm/today";
import { formatCnj } from "@flyee/rules/cnj";

/**
 * What waits for somebody of the firm, wherever the person is: the pending
 * items of the header (migration 0044). The counts of the home (`firm_today`)
 * and what only this center reads (`firm_pending`), sorted into four groups by
 * how soon somebody must act:
 *
 *   late    what passed its time: deadlines past their day (each, with its
 *           case), hearings with no word on them, papers nobody decided for
 *           too long, cases ONE waits on for too long, messages that did not
 *           go out, complaints past their day, a calendar or a reading that
 *           stopped;
 *   today   what falls today, and in the next days;
 *   one     what keeps ONE from carrying on: each case it waits on, with what
 *           it waits for, and every decision only a person takes;
 *   review  what is good to look at and holds nothing up.
 *
 * The first three are the badge: nothing pending or late goes unseen. The
 * last is shown and not counted. Who is looking decides what is theirs, as
 * on the home (`todayNeeds`).
 */

export type OneWait = { caseId: string; seq: number; client: string; waiting: string; since: string | null };

export type OverdueDeadline = {
  deadlineId: string;
  caseId: string | null;
  seq: number | null;
  title: string;
  cnj: string;
  dueOn: string;
};

export type FirmPending = {
  oneWaits: OneWait[];
  oneWaitsTotal: number;
  oneWaitsStale: number;
  deadlinesOverdue: OverdueDeadline[];
  deadlinesToday: number;
  hearingsToday: number;
  documentsStale: number;
  documentsStaleHours: number;
  oneWaitsStaleDays: number;
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneWaitOf(raw: unknown): OneWait | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const caseId = text(row.case_id);
  const seq = count(row.seq);
  const waiting = text(row.waiting);
  if (!caseId || !UUID.test(caseId) || !seq || !waiting) return null;
  return { caseId, seq, client: text(row.client) ?? "", waiting, since: text(row.since) };
}

function overdueOf(raw: unknown): OverdueDeadline | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const deadlineId = text(row.deadline_id);
  const title = text(row.title);
  const dueOn = text(row.due_on);
  const caseId = text(row.case_id);
  if (!deadlineId || !title || !dueOn || !DAY.test(dueOn)) return null;
  return {
    deadlineId,
    caseId: caseId && UUID.test(caseId) ? caseId : null,
    seq: count(row.seq),
    title,
    cnj: text(row.cnj) ?? "",
    dueOn,
  };
}

/** The database's answer, checked. Null when it is not what was expected: the center then says it could not read. */
export function readFirmPending(raw: unknown): FirmPending | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const oneWaitsTotal = count(answer.one_waits_total);
  const oneWaitsStale = count(answer.one_waits_stale);
  const deadlinesToday = count(answer.deadlines_today);
  const hearingsToday = count(answer.hearings_today);
  const documentsStale = count(answer.documents_stale);
  const documentsStaleHours = count(answer.documents_stale_hours);
  const oneWaitsStaleDays = count(answer.one_waits_stale_days);
  if (
    oneWaitsTotal === null ||
    oneWaitsStale === null ||
    deadlinesToday === null ||
    hearingsToday === null ||
    documentsStale === null ||
    documentsStaleHours === null ||
    oneWaitsStaleDays === null ||
    !Array.isArray(answer.one_waits) ||
    !Array.isArray(answer.deadlines_overdue)
  ) {
    return null;
  }
  return {
    oneWaits: answer.one_waits.map(oneWaitOf).filter((row): row is OneWait => row !== null),
    oneWaitsTotal,
    oneWaitsStale,
    deadlinesOverdue: answer.deadlines_overdue.map(overdueOf).filter((row): row is OverdueDeadline => row !== null),
    deadlinesToday,
    hearingsToday,
    documentsStale,
    documentsStaleHours,
    oneWaitsStaleDays,
  };
}

export type PendingGroupKey = "late" | "today" | "one" | "review";

/** Words of the `product` namespace, with their values; a value that is itself words is said first (`message`). */
export type PendingText = { key: string; values?: Record<string, string | number | { message: string }> };

/** One line of the center: what, of which case and why, and where it is done. */
export type PendingItem = {
  /** Stable while the thing waits: what the center compares to say something new arrived. */
  id: string;
  href: string;
  label: PendingText;
  detail?: PendingText;
  /** How many things the line stands for; one when it is one thing of one case. */
  count: number;
};

export type PendingGroup = { key: PendingGroupKey; items: PendingItem[]; total: number };

/** The group of each need of the home. A need left out (the ones split below) is placed by hand. */
const NEED_GROUP: Partial<Record<TodayNeed["key"], PendingGroupKey>> = {
  unresolved: "late",
  complaints: "late",
  failed: "late",
  calendar: "late",
  reading: "late",
  closing: "today",
  approvals: "one",
  publications: "one",
  confirm: "one",
  recheck: "one",
  untimed: "one",
  unwritten: "one",
  drafts: "one",
  filings: "one",
  civil: "one",
  contested: "one",
  unwarned: "one",
  cancelled: "one",
  checks: "review",
  clients: "review",
  moved: "review",
  waiting: "review",
  queue: "review",
};

/** A day of the calendar as people read it: 12/10/2026. */
const dayLabel = (day: string): string => day.split("-").reverse().join("/");

/** Whole days between a moment and now; 0 the same day. */
export function daysSince(since: string | null, now: Date): number {
  if (!since) return 0;
  const then = Date.parse(since);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

const needItem = (need: TodayNeed): PendingItem => ({
  id: `need:${need.key}`,
  href: need.href,
  label: { key: `today-need-${need.key}` },
  detail: { key: `today-need-${need.key}-hint` },
  count: need.count,
});

/** The groups of the center, most urgent first, each with what it holds; a group with nothing is left out. */
export function pendingGroups(
  today: FirmToday,
  pending: FirmPending,
  viewer: TodayViewer,
  now: Date = new Date(),
): PendingGroup[] {
  const groups: Record<PendingGroupKey, PendingItem[]> = { late: [], today: [], one: [], review: [] };
  const needs = todayNeeds(today, viewer);

  // Deadlines past their day, each with its case: the one thing nothing else may come before.
  if (viewer.worksDeadlines && today.deadlinesOverdue > 0) {
    for (const deadline of pending.deadlinesOverdue) {
      groups.late.push({
        id: `deadline:${deadline.deadlineId}`,
        href: deadline.caseId ? `/casos/${deadline.caseId}` : "/prazos?ver=vencidos",
        label: { key: "pending-deadline", values: { title: deadline.title } },
        detail:
          deadline.seq !== null
            ? { key: "pending-deadline-detail", values: { seq: deadline.seq, day: dayLabel(deadline.dueOn) } }
            : {
                key: "pending-deadline-detail-lawsuit",
                values: { cnj: formatCnj(deadline.cnj) ?? deadline.cnj, day: dayLabel(deadline.dueOn) },
              },
        count: 1,
      });
    }
    const unlisted = today.deadlinesOverdue - pending.deadlinesOverdue.length;
    if (unlisted > 0) {
      groups.late.push({
        id: "need:overdue",
        href: "/prazos?ver=vencidos",
        label: { key: "pending-deadlines-more", values: { count: unlisted } },
        count: unlisted,
      });
    }
  }

  // Papers nobody decided for longer than the setting's hours are late; the rest are to look at.
  if (pending.documentsStale > 0) {
    groups.late.push({
      id: "documents:stale",
      href: "/casos?ver=documentos",
      label: {
        key: "pending-documents-stale",
        values: { count: pending.documentsStale, hours: pending.documentsStaleHours },
      },
      count: pending.documentsStale,
    });
  }
  const freshDocuments = Math.max(today.documentsToReview - pending.documentsStale, 0);
  if (freshDocuments > 0) {
    groups.review.push({
      id: "need:documents",
      href: "/casos?ver=documentos",
      label: { key: "today-need-documents" },
      detail: { key: "today-need-documents-hint" },
      count: freshDocuments,
    });
  }

  // Each case ONE carries and cannot carry on without a person, with what it waits for.
  for (const wait of pending.oneWaits) {
    const days = daysSince(wait.since, now);
    const stale = days >= pending.oneWaitsStaleDays;
    groups[stale ? "late" : "one"].push({
      id: `case:${wait.caseId}:${wait.waiting}`,
      href: waitingFix(wait.waiting)?.href ?? `/casos/${wait.caseId}`,
      label: wait.client
        ? { key: "pending-case", values: { seq: wait.seq, client: wait.client } }
        : { key: "pending-case-unnamed", values: { seq: wait.seq } },
      detail: { key: "pending-case-waits", values: { days, reason: { message: waitingKey(wait.waiting) } } },
      count: 1,
    });
  }
  const unlistedCases = pending.oneWaitsTotal - pending.oneWaits.length;
  if (unlistedCases > 0) {
    groups.one.push({
      id: "cases:more",
      href: "/casos",
      label: { key: "pending-cases-more", values: { count: unlistedCases } },
      count: unlistedCases,
    });
  }

  // What falls today, apart from what falls in the next days.
  if (viewer.worksDeadlines) {
    if (pending.deadlinesToday > 0) {
      groups.today.push({
        id: "deadlines:today",
        href: "/prazos?ver=proximos",
        label: { key: "pending-deadlines-today", values: { count: pending.deadlinesToday } },
        count: pending.deadlinesToday,
      });
    }
    const laterDeadlines = Math.max(today.deadlinesSoon - pending.deadlinesToday, 0);
    if (laterDeadlines > 0) {
      groups.today.push({
        id: "deadlines:soon",
        href: "/prazos?ver=proximos",
        label: { key: "pending-deadlines-later", values: { count: laterDeadlines } },
        count: laterDeadlines,
      });
    }
    if (pending.hearingsToday > 0) {
      groups.today.push({
        id: "hearings:today",
        href: "/agenda",
        label: { key: "pending-hearings-today", values: { count: pending.hearingsToday } },
        count: pending.hearingsToday,
      });
    }
    const laterHearings = Math.max(today.hearingsSoon - pending.hearingsToday, 0);
    if (laterHearings > 0) {
      groups.today.push({
        id: "hearings:soon",
        href: "/agenda",
        label: { key: "pending-hearings-later", values: { count: laterHearings } },
        count: laterHearings,
      });
    }
  }

  // Every other need of the home, in the home's own order, in its group (the deadlines, hearings and papers
  // were placed above, split by how soon).
  for (const entry of needs) {
    const group = NEED_GROUP[entry.key];
    if (group) groups[group].push(needItem(entry));
  }
  const order: PendingGroupKey[] = ["late", "today", "one", "review"];
  return order
    .map((key) => ({
      key,
      items: groups[key],
      total: groups[key].reduce((sum, item) => sum + item.count, 0),
    }))
    .filter((group) => group.items.length > 0);
}

/** What the badge counts: everything but what is only to look at. */
export function pendingBadge(groups: readonly PendingGroup[]): number {
  return groups.filter((group) => group.key !== "review").reduce((sum, group) => sum + group.total, 0);
}

/** Something passed its time. */
export const pendingLate = (groups: readonly PendingGroup[]): boolean =>
  groups.some((group) => group.key === "late" && group.total > 0);

/** The ids that would make somebody stop: a new one of these is told at once, wherever the person is. */
export const urgentIds = (groups: readonly PendingGroup[]): string[] =>
  groups
    .filter((group) => group.key === "late" || group.key === "one")
    .flatMap((group) => group.items.map((item) => item.id));
