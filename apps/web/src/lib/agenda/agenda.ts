import { readCount } from "@/lib/deadlines/deadlines";
import { HEARING_KINDS, type HearingKind } from "@/lib/hearings/hearings";
import { internalDeadline, nationalHoliday } from "@flyee/rules/deadlines";

/**
 * The agenda of a firm and of each person in it (migration 0132), as pure rules: the fatal deadlines with the internal
 * one the firm works to (`internalDeadline`, some of the court's business days before), the hearings in their own
 * zone, who answers for each, the grids of a day, a week and a month, and what the e-mail of the morning says.
 *
 * What an e-mail or a calendar link says of an item is the act's name, or "Prazo", and the case's number: never a
 * typed title, which may hold the client's name.
 */

export type AgendaDeadline = {
  id: string;
  act: string | null;
  actName: string | null;
  /** The typed title: shown on the firm's own screens only, never in an e-mail or a calendar link. */
  title: string;
  status: "proposed" | "confirmed";
  /** The fatal day: the day the firm works with. */
  dueOn: string;
  /** The internal day, some business days before; null when the firm switched it off or it cannot be told. */
  internalOn: string | null;
  caseId: string | null;
  caseSeq: number | null;
  isTest: boolean;
  cnj: string;
  court: string;
  changedAt: string | null;
  people: string[];
};

export type AgendaHearing = {
  id: string;
  kind: HearingKind;
  mode: string;
  status: string;
  startsAt: string;
  timeZone: string;
  caseId: string | null;
  caseSeq: number | null;
  isTest: boolean;
  cnj: string;
  court: string;
  attendee: string | null;
  changedAt: string | null;
  people: string[];
};

export type AgendaItems = { deadlines: AgendaDeadline[]; hearings: AgendaHearing[]; durationMinutes: number };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (value: unknown): value is string => typeof value === "string" && DAY.test(value);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const ids = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];

/** The internal day of a deadline: from its fatal day back over the days its count saw, never before its first. */
export function internalDayOf(
  dueOn: string,
  explanation: unknown,
  startsOn: string | null,
  days: number,
): string | null {
  if (days <= 0) return null;
  const count = readCount(explanation);
  const first = count?.startsOn ?? (isDay(startsOn) ? startsOn : null);
  if (!first) return null;
  return internalDeadline({ dueOn, startsOn: first, skipped: count?.skipped ?? [] }, days);
}

/** The items the database answered (`agenda_items`), each deadline with its internal day by the firm's days. */
export function readAgendaItems(raw: unknown, internalDays: number): AgendaItems {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const deadlines = list(answer.deadlines).flatMap((row): AgendaDeadline[] => {
    const id = text(row.id);
    const dueOn = isDay(row.due_on) ? row.due_on : null;
    if (!id || !dueOn || (row.status !== "proposed" && row.status !== "confirmed")) return [];
    return [
      {
        id,
        act: text(row.act),
        actName: text(row.act_name),
        title: text(row.title) ?? "",
        status: row.status,
        dueOn,
        internalOn: internalDayOf(dueOn, row.explanation, text(row.starts_on), internalDays),
        caseId: text(row.case_id),
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        isTest: row.is_test === true,
        cnj: text(row.cnj) ?? "",
        court: text(row.court) ?? "",
        changedAt: text(row.changed_at),
        people: ids(row.people),
      },
    ];
  });
  const hearings = list(answer.hearings).flatMap((row): AgendaHearing[] => {
    const id = text(row.id);
    const startsAt = text(row.starts_at);
    const kind = (HEARING_KINDS as readonly unknown[]).includes(row.kind) ? (row.kind as HearingKind) : "outra";
    if (!id || !startsAt || Number.isNaN(Date.parse(startsAt))) return [];
    return [
      {
        id,
        kind,
        mode: text(row.mode) ?? "presencial",
        status: text(row.status) ?? "scheduled",
        startsAt,
        timeZone: text(row.time_zone) ?? "America/Sao_Paulo",
        caseId: text(row.case_id),
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        isTest: row.is_test === true,
        cnj: text(row.cnj) ?? "",
        court: text(row.court) ?? "",
        attendee: text(row.attendee_user_id),
        changedAt: text(row.changed_at),
        people: ids(row.people),
      },
    ];
  });
  const duration = typeof answer.duration_minutes === "number" ? answer.duration_minutes : 60;
  return { deadlines, hearings, durationMinutes: Math.max(Math.round(duration), 1) };
}

// ---------- Days ----------

const toNumber = (day: string): number =>
  Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 86_400_000;
const toDay = (number: number): string => new Date(number * 86_400_000).toISOString().slice(0, 10);

export const addDays = (day: string, days: number): string => toDay(toNumber(day) + days);
/** 0 is Sunday. */
export const weekdayNumber = (day: string): number => new Date(toNumber(day) * 86_400_000).getUTCDay();
export const isBusinessDay = (day: string): boolean => {
  const weekday = weekdayNumber(day);
  return weekday !== 0 && weekday !== 6 && nationalHoliday(day) === null;
};

/** The Monday of a day's week. */
export const weekStart = (day: string): string => addDays(day, -((weekdayNumber(day) + 6) % 7));

/** The days of a week, Monday first. */
export const weekDays = (day: string): string[] =>
  Array.from({ length: 7 }, (_, index) => addDays(weekStart(day), index));

/** The grid of a month: six weeks from the Monday on or before its first day. */
export function monthGrid(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  return Array.from({ length: 42 }, (_, index) => addDays(weekStart(first), index));
}

export const AGENDA_MODES = ["lista", "dia", "semana", "mes"] as const;
export type AgendaMode = (typeof AGENDA_MODES)[number];
export const isAgendaMode = (value: unknown): value is AgendaMode =>
  (AGENDA_MODES as readonly unknown[]).includes(value);

/** The days a mode shows around a day: one, a week, or the six weeks of a month's grid. */
export function rangeOf(mode: Exclude<AgendaMode, "lista">, day: string): { from: string; to: string } {
  if (mode === "dia") return { from: day, to: day };
  if (mode === "semana") return { from: weekStart(day), to: addDays(weekStart(day), 6) };
  const grid = monthGrid(day);
  return { from: grid[0]!, to: grid[grid.length - 1]! };
}

/** The day a mode moves to, back or forward. */
export function stepOf(mode: Exclude<AgendaMode, "lista">, day: string, direction: 1 | -1): string {
  if (mode === "dia") return addDays(day, direction);
  if (mode === "semana") return addDays(day, 7 * direction);
  const year = +day.slice(0, 4);
  const month = +day.slice(5, 7) - 1 + direction;
  const moved = new Date(Date.UTC(year, month, 1));
  return moved.toISOString().slice(0, 10);
}

/** A moment's day and hour in a zone ("2026-11-12", "14:30"). */
export function localOf(moment: string, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(moment));
  const of = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${of("year")}-${of("month")}-${of("day")}`, time: `${of("hour")}:${of("minute")}` };
}

// ---------- Entries ----------

export type AgendaEntry =
  | { kind: "fatal"; day: string; deadline: AgendaDeadline }
  | { kind: "internal"; day: string; deadline: AgendaDeadline }
  | { kind: "hearing"; day: string; time: string; hearing: AgendaHearing };

const ORDER: Record<AgendaEntry["kind"], number> = { fatal: 0, hearing: 1, internal: 2 };

/** Whose items an agenda shows: everybody's, or one person's (who answers for it). */
export type AgendaPerson = { kind: "all" } | { kind: "person"; id: string };

/**
 * The entries of the days from `from` to `to`, of one person or everybody: each deadline on its fatal day and on its
 * internal day, each hearing on its own day in its zone (a cancelled one too, said so). The fatal ones first in a day,
 * then the hearings by their hour, then the internal ones.
 */
export function agendaEntries(items: AgendaItems, person: AgendaPerson, from: string, to: string): AgendaEntry[] {
  const mine = (people: readonly string[]) => person.kind === "all" || people.includes(person.id);
  const within = (day: string) => day >= from && day <= to;
  const entries: AgendaEntry[] = [];
  for (const deadline of items.deadlines) {
    if (!mine(deadline.people)) continue;
    if (within(deadline.dueOn)) entries.push({ kind: "fatal", day: deadline.dueOn, deadline });
    if (deadline.internalOn && deadline.internalOn !== deadline.dueOn && within(deadline.internalOn)) {
      entries.push({ kind: "internal", day: deadline.internalOn, deadline });
    }
  }
  for (const hearing of items.hearings) {
    if (!mine(hearing.people)) continue;
    const local = localOf(hearing.startsAt, hearing.timeZone);
    if (within(local.day)) entries.push({ kind: "hearing", day: local.day, time: local.time, hearing });
  }
  return entries.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      ORDER[a.kind] - ORDER[b.kind] ||
      (a.kind === "hearing" && b.kind === "hearing" ? a.time.localeCompare(b.time) : 0) ||
      entryId(a).localeCompare(entryId(b)),
  );
}

export const entryId = (entry: AgendaEntry): string =>
  entry.kind === "hearing" ? `hearing:${entry.hearing.id}` : `${entry.kind}:${entry.deadline.id}`;

/** The entries of each day, for a grid. */
export function entriesByDay(entries: readonly AgendaEntry[]): Map<string, AgendaEntry[]> {
  const days = new Map<string, AgendaEntry[]>();
  for (const entry of entries) {
    const day = days.get(entry.day) ?? [];
    day.push(entry);
    days.set(entry.day, day);
  }
  return days;
}

/** A hearing that is not to be held: cancelled. */
export const hearingCancelled = (hearing: AgendaHearing): boolean => hearing.status === "cancelled";

// ---------- What an e-mail or a calendar link says ----------

const HEARING_WORDS: Record<HearingKind, string> = {
  conciliacao: "Audiência de conciliação",
  instrucao: "Audiência de instrução e julgamento",
  una: "Audiência una",
  outra: "Audiência",
};

/** The case as an outsider reads it: its number, never a client's name. */
export const caseWords = (caseSeq: number | null): string | null => (caseSeq !== null ? `Caso ${caseSeq}` : null);

/** What an item is called outside ONE's own screens: the act's name, or "Prazo"; the hearing's kind. */
export function outsideName(entry: AgendaEntry): string {
  if (entry.kind === "hearing") return HEARING_WORDS[entry.hearing.kind];
  const act = entry.deadline.actName ?? "Prazo";
  return entry.kind === "fatal" ? `Prazo fatal: ${act}` : `Prazo interno: ${act}`;
}

/** The zone of a hearing in words, when it is not Brasília's. */
export function zoneWords(timeZone: string): string | null {
  if (timeZone === "America/Sao_Paulo") return null;
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  return `horário de ${city}`;
}

// ---------- The e-mail of the morning ----------

export type DigestLine = {
  /** fatal, internal or hearing. */
  kind: AgendaEntry["kind"];
  name: string;
  caseWords: string | null;
  cnj: string;
  day: string;
  /** The hour of a hearing, and its zone when not Brasília's. */
  time: string | null;
  zone: string | null;
  cancelled: boolean;
  /** Changed since the e-mail before (in the last day). */
  changed: boolean;
  caseId: string | null;
};

export type Digest = { today: DigestLine[]; next: DigestLine[] };

/**
 * What a person's e-mail of a day says: the fatal and the internal deadlines and the hearings of the day, and those of
 * the next 48 hours with what changed since the e-mail before. Of the whole firm for who reads it whole, else of what
 * the person answers for; the test cases out. Empty when there is nothing: then no e-mail goes.
 */
export function digestFor(
  items: AgendaItems,
  person: { userId: string; wholeFirm: boolean },
  today: string,
  now: Date,
): Digest {
  const who: AgendaPerson = person.wholeFirm ? { kind: "all" } : { kind: "person", id: person.userId };
  const since = now.getTime() - 24 * 60 * 60 * 1000;
  const real: AgendaItems = {
    ...items,
    deadlines: items.deadlines.filter((deadline) => !deadline.isTest),
    hearings: items.hearings.filter((hearing) => !hearing.isTest),
  };
  const lineOf = (entry: AgendaEntry): DigestLine => {
    const changedAt = entry.kind === "hearing" ? entry.hearing.changedAt : entry.deadline.changedAt;
    const changed = changedAt !== null && Date.parse(changedAt) >= since;
    if (entry.kind === "hearing") {
      return {
        kind: "hearing",
        name: outsideName(entry),
        caseWords: caseWords(entry.hearing.caseSeq),
        cnj: entry.hearing.cnj,
        day: entry.day,
        time: entry.time,
        zone: zoneWords(entry.hearing.timeZone),
        cancelled: hearingCancelled(entry.hearing),
        changed,
        caseId: entry.hearing.caseId,
      };
    }
    return {
      kind: entry.kind,
      name: outsideName(entry),
      caseWords: caseWords(entry.deadline.caseSeq),
      cnj: entry.deadline.cnj,
      day: entry.day,
      time: null,
      zone: null,
      cancelled: false,
      changed,
      caseId: entry.deadline.caseId,
    };
  };
  const todays = agendaEntries(real, who, today, today)
    // A hearing cancelled is said today only when it changed since the e-mail before: else it is no news.
    .filter((entry) => entry.kind !== "hearing" || !hearingCancelled(entry.hearing) || lineOf(entry).changed)
    .map(lineOf);
  const next = agendaEntries(real, who, addDays(today, 1), addDays(today, 2))
    .filter((entry) => entry.kind !== "hearing" || !hearingCancelled(entry.hearing) || lineOf(entry).changed)
    .map(lineOf);
  return { today: todays, next };
}

export const digestEmpty = (digest: Digest): boolean => digest.today.length === 0 && digest.next.length === 0;

/** Whether the e-mail of the morning goes on a day: a business day, from seven o'clock of Brasília to noon. */
export function digestHour(now: Date): { day: string; due: boolean } {
  const local = localOf(now.toISOString(), "America/Sao_Paulo");
  const hour = Number.parseInt(local.time.slice(0, 2), 10);
  return { day: local.day, due: isBusinessDay(local.day) && hour >= 7 && hour < 12 };
}
