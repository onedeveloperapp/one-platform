import { readDay } from "@flyee/rules/person";

/**
 * The deadline of a procedural act (rule `prazo-v3`): the day a term set in
 * days runs out, counted the way the Código de Processo Civil counts it
 * (Lei nº 13.105/2015) over the forensic calendar of the court the lawsuit
 * is in. The small-claims court counts the same way since Lei nº
 * 13.728/2018 (Lei nº 9.099/1995, art. 12-A: business days only), and so do
 * the labour courts (CLT, art. 775, as Lei nº 13.467/2017 wrote it: business
 * days, the first day left out and the last one counted; art. 775-A: no term
 * runs from 20 December to 20 January) and the federal small-claims courts
 * (Lei nº 10.259/2001, art. 1º, which takes Lei nº 9.099/1995 in; art. 9º:
 * no public entity has a term of its own there, and the rule never doubles
 * a term anywhere: the term in days is the act's).
 *
 *   - Only business days count (CPC, art. 219), unless the term is in
 *     calendar days. A business day is one with forensic business: not a
 *     Saturday, a Sunday, a holiday, nor a day the court had no business
 *     (art. 216).
 *   - The day the term runs from is left out and the last one counts
 *     (art. 224). A communication of the DJEN is published on the first
 *     business day after the day it was made available (§ 2º), and the
 *     count starts on the first business day after the publication (§ 3º;
 *     Resolução CNJ nº 455/2022, art. 11, § 3º, as Resolução CNJ nº
 *     569/2024 wrote it, from 16 May 2025 on).
 *   - When the same act was also intimated in the court's own system, the
 *     intimation is made on the day the lawyer read it, the next business
 *     day when read on a day with none, or on the tenth day when unread
 *     (Lei nº 11.419/2006, art. 5º, §§ 1º to 3º), and the person gives that
 *     day. The term then runs from the earlier of the two: which one prevails
 *     is the STJ's Tema 1.180, whose thesis the rule does not take as settled,
 *     and an earlier start never puts a deadline later than it is.
 *   - Terms in business days do not run from 20 December to 20 January,
 *     both included (art. 220), in every court of the country, the
 *     small-claims courts too (Resolução CNJ nº 244/2016, art. 3º), nor on
 *     a day the court suspended them.
 *   - A last day on which the court's business started late or ended
 *     early, or the electronic system was unavailable, moves to the next
 *     business day (art. 224, § 1º); a last day with no business moves too.
 *
 * The calendar of each court (the days it had no business, the days it
 * suspended terms, the days of partial business, by comarca, kind of
 * lawsuit and system) is data the caller hands in, read from the court's
 * acts. The national holidays fixed by federal law are the rule's own, and,
 * in the federal courts (a TRF, its sections and their small-claims courts),
 * the holidays of the Justiça Federal (Lei nº 5.010/1966, art. 62): 20
 * December to 6 January, Holy Week from Wednesday to Easter Sunday, the
 * Monday and Tuesday of Carnival, 11 August, 1 and 2 November and 8
 * December. A labour court's days off are its own calendar's, as a state
 * court's are: the rule does not take them as law, so a calendar not on
 * record gives the earlier day.
 *
 * The rule is conservative: where it cannot know, it takes the reading that
 * gives the earlier day, which never puts a deadline later than it is, and
 * says so in an assumption for the person who confirms the deadline to
 * weigh: a year whose calendar nobody checked, a comarca whose own holidays
 * are not on record, a day of partial business at the start of the term
 * (whether it moves the start is read in two ways), a start day the person
 * gave that was no business day. A term in calendar days is one the rule
 * cannot tell procedural from not (art. 219 counts every procedural term in
 * business days, and a suspension of procedural terms does not stop the
 * others): it runs through the suspensions, and the rule says that a
 * procedural one would end later. It decides nothing alone: a person of the
 * firm confirms every deadline.
 */

/**
 * `prazo-v2` (2026-11-10) also takes the day the same act was intimated in the court's own system, when a person gave
 * it, and counts from the earlier of the two; `prazo-v1` knew only the DJEN's. A count keeps the version it was made by.
 */
/**
 * `prazo-v3` (2026-11-21) knows the justice the lawsuit is in: the holidays of the Justiça Federal in a federal court
 * (Lei nº 5.010/1966, art. 62), and the count of the labour and the federal small-claims courts said as their law says
 * it. A count keeps the version it was made by.
 */
export const DEADLINE_RULE_VERSION = "prazo-v3";
export type DeadlineRuleVersion = "prazo-v1" | "prazo-v2" | typeof DEADLINE_RULE_VERSION;

/** The justice a lawsuit runs in: a state court, a labour court or a federal one. */
export const JUSTICES = ["estadual", "trabalho", "federal"] as const;
export type Justice = (typeof JUSTICES)[number];

/** The justice of a court by its acronym as the DJEN and ONE write it: TRT18 and TST are labour, TRF1 is federal. */
export function justiceOfCourt(acronym: string | null | undefined): Justice {
  const court = (acronym ?? "").trim().toUpperCase();
  if (/^(TRT\d{1,2}|TST)$/.test(court)) return "trabalho";
  if (/^(TRF\d|JF[A-Z]{2})$/.test(court)) return "federal";
  return "estadual";
}

export const DEADLINE_COUNTINGS = ["business", "calendar"] as const;
export type DeadlineCounting = (typeof DEADLINE_COUNTINGS)[number];

/**
 * - `publication`: a communication of the DJEN, by the day it was made available;
 * - `day`: a day the person names, the term running from it (an intimation read in the court's
 *   system, one made in a hearing).
 */
export const DEADLINE_TRIGGERS = ["publication", "day"] as const;
export type DeadlineTrigger = (typeof DEADLINE_TRIGGERS)[number];

/**
 * - `closed`: no forensic business (a holiday of the court or of a comarca, a recess, a day off the
 *   court decreed);
 * - `partial`: business started late or ended early, or the electronic system was unavailable
 *   (CPC, art. 224, § 1º);
 * - `suspended`: the court suspended the terms, with business or without.
 */
export const CALENDAR_DAY_KINDS = ["closed", "partial", "suspended"] as const;
export type CalendarDayKind = (typeof CALENDAR_DAY_KINDS)[number];

/** The longest term the rule counts, in days. */
export const MAX_DEADLINE_DAYS = 365;

/** From this day on, a communication of the DJEN is what a term runs from (Resolução CNJ nº 569/2024). */
export const DJEN_RULE_FROM = "2025-05-16";

/** The earliest and the latest day a term may run from: before 2019 the small-claims court counted calendar days. */
export const DEADLINE_FIRST_DAY = "2019-01-01";
export const DEADLINE_LAST_DAY = "2100-12-31";

export interface CalendarDay {
  day: string;
  kind: CalendarDayKind;
  /** What the court's act calls it: "Carnaval", "Expediente a partir das 12h". */
  label: string;
  /** The kinds of lawsuit it applies to (`juizado`, `comum`); empty for every one. */
  proceedingKinds: readonly string[];
  /** The systems it applies to (`projudi`, `pje`); empty for every one. */
  systems: readonly string[];
  /** The comarcas it applies to, by name; empty for every comarca of the court. */
  comarcas: readonly string[];
}

export interface CalendarYear {
  year: number;
  /** The calendar holds the days of every comarca of the court, its local holidays included. */
  allComarcas: boolean;
  /** Otherwise, the comarcas whose own days it holds, by name. */
  comarcas: readonly string[];
  /** The day it was checked against the court's act: what the court decreed after it is not in it. */
  checkedOn?: string | null;
}

export interface CourtCalendar {
  /** The years whose calendar somebody checked against the court's acts. */
  years: readonly CalendarYear[];
  days: readonly CalendarDay[];
}

/** Where the lawsuit runs: what decides which days of the court's calendar are its own. Null when not known. */
export interface DeadlinePlace {
  proceedingKind: string | null;
  system: string | null;
  comarca: string | null;
}

export interface DeadlineInput {
  trigger: DeadlineTrigger;
  /** For a publication, the day the DJEN made it available; otherwise the day the term runs from. */
  on: string;
  days: number;
  counting: DeadlineCounting;
  place: DeadlinePlace;
  calendar: CourtCalendar;
  /**
   * For a publication: the day the lawyer was intimated of the same act in the court's own system (read, or the
   * tenth day when unread), when a person said so; the term runs from it when it came first.
   */
  portalOn?: string | null;
  /** The justice of the lawsuit's court (`justiceOfCourt`); a state court when not said. */
  justice?: Justice;
}

/**
 * Why a day did not count:
 * - `suspension`: 20 December to 20 January (CPC, art. 220);
 * - `court_suspension`: the court suspended the terms;
 * - `closed`: the court had no business;
 * - `holiday`: a national holiday;
 * - `partial`: the court's business was partial, and the last day moved past it.
 */
export type DeadlineSkipReason = "suspension" | "court_suspension" | "closed" | "holiday" | "partial";

/** Days in a row that did not count, for one reason. Weekends alone are left out: they never count. */
export interface DeadlineSkip {
  from: string;
  to: string;
  reason: DeadlineSkipReason;
  /** What the calendar calls it; empty for the suspension of the code. */
  label: string;
}

export type DeadlineAssumption =
  /** No calendar of the court was checked for these years: beyond weekends, national holidays and the code's suspension, only the days already on record count. */
  | { code: "calendar_unchecked"; years: number[] }
  /** The comarca of the lawsuit is not known: no day of a comarca of its own was applied. */
  | { code: "comarca_unknown" }
  /** The calendar of these years does not hold the comarca's own days: its local holidays are not on record. */
  | { code: "local_days_unchecked"; years: number[] }
  /** Days of the calendar that apply to a kind of lawsuit or a system the lawsuit's is not known to be: not applied. */
  | { code: "scope_unknown"; what: "proceeding_kind" | "system"; days: string[] }
  /** The day the term runs from, or its first day, had partial business: read as moving the start, the deadline may be a business day later. */
  | { code: "partial_start"; day: string; label: string }
  /** The day the person gave is no business day: if the intimation was read on it, the law takes it as made on the next business day. */
  | { code: "start_not_business"; day: string }
  /** Made available before the DJEN's publication was what terms run from. */
  | { code: "djen_before_rule" }
  /** The lawyer was intimated in the court's own system before the DJEN published it: the term runs from that day. */
  | { code: "portal_first"; day: string }
  /** A term in calendar days ran through a suspension of procedural terms: a procedural one stops there, and ends later. */
  | { code: "calendar_suspension" };

export interface DeadlineResult {
  rule: DeadlineRuleVersion;
  /** The justice the count followed; absent in a count made before `prazo-v3`. */
  justice?: Justice;
  trigger: DeadlineTrigger;
  /** The day the input named: the day a publication was made available, or the day given. */
  triggerDay: string;
  /** For a publication: the first business day after it was made available (CPC, art. 224, § 2º). */
  publishedOn: string | null;
  /** The day the term runs from, left out of the count. */
  fromDay: string;
  /** The first day counted. */
  startsOn: string;
  /** The last day counted, before a move. */
  countedDueOn: string;
  /** The deadline. */
  dueOn: string;
  days: number;
  counting: DeadlineCounting;
  skipped: DeadlineSkip[];
  /** The last day counted, moved to the next business day: why, and where to. */
  moved: { from: string; to: string; reason: "partial" | "not_business"; label: string } | null;
  assumptions: DeadlineAssumption[];
  /** The checked years of the court's calendar the count went through, each with the day it was checked. */
  checkedYears: { year: number; checkedOn: string | null }[];
}

export type DeadlineFailure = "invalid_trigger" | "invalid_counting" | "invalid_days" | "invalid_day" | "too_long";

export type DeadlineOutcome = { ok: true; result: DeadlineResult } | { ok: false; code: DeadlineFailure };

/**
 * The national holidays fixed by federal law: Lei nº 662/1949 (as Lei nº 10.607/2002 wrote it),
 * Lei nº 6.802/1980 (12 October) and Lei nº 14.759/2023 (20 November, from 2024 on). Carnival, Holy
 * Week and Corpus Christi are no holiday of federal law: they are each court's, in its calendar.
 */
const NATIONAL_HOLIDAYS: readonly { month: number; day: number; name: string; since?: number }[] = [
  { month: 1, day: 1, name: "Confraternização Universal" },
  { month: 4, day: 21, name: "Tiradentes" },
  { month: 5, day: 1, name: "Dia do Trabalho" },
  { month: 9, day: 7, name: "Independência do Brasil" },
  { month: 10, day: 12, name: "Nossa Senhora Aparecida" },
  { month: 11, day: 2, name: "Finados" },
  { month: 11, day: 15, name: "Proclamação da República" },
  { month: 11, day: 20, name: "Dia Nacional de Zumbi e da Consciência Negra", since: 2024 },
  { month: 12, day: 25, name: "Natal" },
];

/** The name of the national holiday on a day, or null. */
export function nationalHoliday(day: string): string | null {
  const read = readDay(day);
  if (!read) return null;
  const found = NATIONAL_HOLIDAYS.find(
    (holiday) => holiday.month === read.month && holiday.day === read.day && read.year >= (holiday.since ?? 0),
  );
  return found?.name ?? null;
}

/** Easter Sunday of a year, by the Gregorian computus, as a day number. */
function easterOf(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/**
 * The name of a holiday of the Justiça Federal on a day (Lei nº 5.010/1966, art. 62), or null: 20 December to 6
 * January, Holy Week from Wednesday to Easter Sunday, the Monday and Tuesday of Carnival, 11 August, 1 and 2 November
 * and 8 December.
 */
export function federalJusticeHoliday(day: string): string | null {
  const read = readDay(day);
  if (!read) return null;
  if ((read.month === 12 && read.day >= 20) || (read.month === 1 && read.day <= 6)) return "Recesso da Justiça Federal";
  const number = Date.UTC(read.year, read.month - 1, read.day) / MS_PER_DAY;
  const easter = easterOf(read.year);
  if (number >= easter - 4 && number <= easter) return "Semana Santa";
  if (number === easter - 48 || number === easter - 47) return "Carnaval";
  if (read.month === 8 && read.day === 11) return "Dia da instalação dos cursos jurídicos";
  if (read.month === 11 && read.day === 1) return "Todos os Santos";
  if (read.month === 11 && read.day === 2) return "Finados";
  if (read.month === 12 && read.day === 8) return "Nossa Senhora da Conceição";
  return null;
}

/** True from 20 December to 20 January, both included: the procedural terms do not run (CPC, art. 220). */
export function inYearEndSuspension(day: string): boolean {
  const read = readDay(day);
  if (!read) return false;
  return (read.month === 12 && read.day >= 20) || (read.month === 1 && read.day <= 20);
}

/** A comarca as it is compared: no accents, lower case, single spaces, without "Comarca de". */
export function comarcaKey(name: string | null | undefined): string {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^comarca (?:(?:de|da|do|das|dos) )?/, "")
    .trim();
}

const MS_PER_DAY = 86_400_000;
/** No term of a year scans this far: a calendar that would make one do so is not one. */
const MAX_SCAN_DAYS = 2_000;

function dayNumber(day: string): number | null {
  const read = readDay(day);
  return read ? Date.UTC(read.year, read.month - 1, read.day) / MS_PER_DAY : null;
}

const dayText = (number: number): string => new Date(number * MS_PER_DAY).toISOString().slice(0, 10);
/** 0 is a Sunday: 1 January 1970 was a Thursday. */
const weekdayOf = (number: number): number => (((number + 4) % 7) + 7) % 7;
const yearOf = (number: number): number => new Date(number * MS_PER_DAY).getUTCFullYear();

interface Why {
  reason: DeadlineSkipReason | "weekend";
  label: string;
}

interface DayFacts {
  number: number;
  day: string;
  weekend: boolean;
  business: boolean;
  /** Why it is no business day, the most telling reason first. */
  notBusiness: Why | null;
  /** The procedural terms do not run on it. */
  suspension: Why | null;
  /** Partial business, on a business day. */
  partial: Why | null;
}

type Scope = "yes" | "no" | "proceeding_kind" | "system" | "comarca";

/** Whether a day of the calendar is the lawsuit's: a known place that differs rules it out; one not known leaves it unsure. */
function scopeOf(entry: CalendarDay, place: { kind: string | null; system: string | null; comarca: string }): Scope {
  const unknown: Scope[] = [];
  if (entry.proceedingKinds.length > 0) {
    if (place.kind === null) unknown.push("proceeding_kind");
    else if (!entry.proceedingKinds.includes(place.kind)) return "no";
  }
  if (entry.systems.length > 0) {
    if (place.system === null) unknown.push("system");
    else if (!entry.systems.includes(place.system)) return "no";
  }
  if (entry.comarcas.length > 0) {
    if (place.comarca === "") unknown.push("comarca");
    else if (!entry.comarcas.some((name) => comarcaKey(name) === place.comarca)) return "no";
  }
  return unknown[0] ?? "yes";
}

const failed = (code: DeadlineFailure): DeadlineOutcome => ({ ok: false, code });

/**
 * What a step of the count looks for in a day:
 * - `opens`: a business day (a publication, or the first day of a term in calendar days after one,
 *   may fall in a suspension: terms do not run, the gazette and the court do);
 * - `runs`: a business day on which the procedural terms run;
 * - `any`: any day (a term in calendar days counts them all);
 * - `closes`: a business day on which the terms run, with business all day (where a term in business
 *   days ends);
 * - `closes_any`: a business day with business all day (where a term in calendar days ends).
 */
type Step = "opens" | "runs" | "any" | "closes" | "closes_any";

/** Counts a deadline. Pure: the same input gives the same deadline, whenever and wherever it is counted. */
export function computeDeadline(input: DeadlineInput): DeadlineOutcome {
  if (!(DEADLINE_TRIGGERS as readonly string[]).includes(input.trigger)) return failed("invalid_trigger");
  if (!(DEADLINE_COUNTINGS as readonly string[]).includes(input.counting)) return failed("invalid_counting");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_DEADLINE_DAYS) return failed("invalid_days");
  const trigger = dayNumber(input.on);
  if (trigger === null || input.on < DEADLINE_FIRST_DAY || input.on > DEADLINE_LAST_DAY) return failed("invalid_day");

  const business = input.counting === "business";
  const justice: Justice =
    input.justice && (JUSTICES as readonly string[]).includes(input.justice) ? input.justice : "estadual";
  const place = {
    kind: input.place.proceedingKind || null,
    system: input.place.system || null,
    comarca: comarcaKey(input.place.comarca),
  };
  const byDay = new Map<string, CalendarDay[]>();
  for (const entry of input.calendar.days) {
    const list = byDay.get(entry.day);
    if (list) list.push(entry);
    else byDay.set(entry.day, [entry]);
  }
  const unsure = { proceeding_kind: new Set<string>(), system: new Set<string>() };
  const memo = new Map<number, DayFacts>();

  const facts = (number: number): DayFacts => {
    const known = memo.get(number);
    if (known) return known;
    const day = dayText(number);
    let closed: CalendarDay | null = null;
    let partial: CalendarDay | null = null;
    let suspended: CalendarDay | null = null;
    for (const entry of byDay.get(day) ?? []) {
      const scope = scopeOf(entry, place);
      if (scope === "proceeding_kind" || scope === "system") {
        unsure[scope].add(day);
        continue;
      }
      // A day of a comarca, for a lawsuit whose comarca is not known: `comarca_unknown` says it.
      if (scope !== "yes") continue;
      if (entry.kind === "closed") closed ??= entry;
      else if (entry.kind === "partial") partial ??= entry;
      else suspended ??= entry;
    }
    const holiday = nationalHoliday(day) ?? (justice === "federal" ? federalJusticeHoliday(day) : null);
    const weekday = weekdayOf(number);
    const weekend = weekday === 0 || weekday === 6;
    const open = !weekend && holiday === null && closed === null;
    const result: DayFacts = {
      number,
      day,
      weekend,
      business: open,
      notBusiness: closed
        ? { reason: "closed", label: closed.label }
        : holiday !== null
          ? { reason: "holiday", label: holiday }
          : weekend
            ? { reason: "weekend", label: "" }
            : null,
      suspension: inYearEndSuspension(day)
        ? { reason: "suspension", label: "" }
        : suspended
          ? { reason: "court_suspension", label: suspended.label }
          : null,
      partial: open && partial ? { reason: "partial", label: partial.label } : null,
    };
    memo.set(number, result);
    return result;
  };

  /** Why a day is not one the step looks for, or null when it is. */
  const whyNot = (day: DayFacts, step: Step): Why | null => {
    if (step === "any") return null;
    if ((step === "runs" || step === "closes") && day.suspension) return day.suspension;
    if (day.notBusiness) return day.notBusiness;
    return step === "closes" || step === "closes_any" ? day.partial : null;
  };

  const skipped = new Map<number, Why>();
  let scanned = 0;
  /** The first day after `from` the step takes, every day passed over on the way noted with why. */
  const next = (from: number, step: Step): number | null => {
    let number = from;
    for (;;) {
      number += 1;
      scanned += 1;
      if (scanned > MAX_SCAN_DAYS) return null;
      const why = whyNot(facts(number), step);
      if (!why) return number;
      if (!skipped.has(number)) skipped.set(number, why);
    }
  };

  const assumptions: DeadlineAssumption[] = [];
  let from = trigger;
  let publishedOn: string | null = null;
  if (input.trigger === "publication") {
    const published = next(trigger, "opens");
    if (published === null) return failed("too_long");
    from = published;
    publishedOn = dayText(published);
    if (input.on < DJEN_RULE_FROM) assumptions.push({ code: "djen_before_rule" });
    // The same act intimated in the court's own system: made on the day the person gives, or on the next business
    // day when that day had none (Lei nº 11.419/2006, art. 5º, § 2º). Where it came first, the term runs from it.
    const portalDay = input.portalOn ?? null;
    const portal =
      portalDay && portalDay >= DEADLINE_FIRST_DAY && portalDay <= DEADLINE_LAST_DAY ? dayNumber(portalDay) : null;
    if (portalDay && portal !== null) {
      let made = portal;
      for (let guard = 0; !facts(made).business; guard += 1) {
        if (guard > 60) return failed("too_long");
        made += 1;
      }
      if (made < from) {
        from = made;
        assumptions.push({ code: "portal_first", day: portalDay });
      }
    }
  } else if (!facts(trigger).business) {
    assumptions.push({ code: "start_not_business", day: input.on });
  }

  // The count starts on the first business day after a publication (§ 3º); a term in calendar days that
  // runs from a day the person gave starts on the day after it.
  const starts = next(from, business ? "runs" : input.trigger === "publication" ? "opens" : "any");
  if (starts === null) return failed("too_long");
  const partialStart = facts(from).partial ?? facts(starts).partial;
  if (partialStart) {
    const day = facts(from).partial ? dayText(from) : dayText(starts);
    assumptions.push({ code: "partial_start", day, label: partialStart.label });
  }

  let last = starts;
  for (let counted = 1; counted < input.days; counted += 1) {
    const found = next(last, business ? "runs" : "any");
    if (found === null) return failed("too_long");
    last = found;
  }

  // The last day moves to the next business day with business all day: a partial day (§ 1º), and in a
  // term of calendar days, a day with no business.
  let due = last;
  let moved: DeadlineResult["moved"] = null;
  const lastDay = facts(last);
  const moveFor: Why | null = business ? lastDay.partial : (lastDay.notBusiness ?? lastDay.partial);
  if (moveFor) {
    const found = next(last, business ? "closes" : "closes_any");
    if (found === null) return failed("too_long");
    due = found;
    moved = {
      from: dayText(last),
      to: dayText(due),
      reason: moveFor.reason === "partial" ? "partial" : "not_business",
      label: moveFor.label,
    };
  }

  // A term in calendar days ran through a suspension of the procedural terms: the rule cannot tell
  // whether it is one of them, so it did not stop, and says that a procedural term ends later.
  if (!business) {
    for (let number = from + 1; number <= due; number += 1) {
      if (facts(number).suspension) {
        assumptions.push({ code: "calendar_suspension" });
        break;
      }
    }
  }

  const years: number[] = [];
  for (let year = yearOf(trigger); year <= yearOf(due); year += 1) years.push(year);
  const checked = new Map(input.calendar.years.map((year) => [year.year, year]));
  const unchecked = years.filter((year) => !checked.has(year));
  if (unchecked.length > 0) assumptions.push({ code: "calendar_unchecked", years: unchecked });
  if (place.comarca === "") {
    assumptions.push({ code: "comarca_unknown" });
  } else {
    const missing = years.filter((year) => {
      const known = checked.get(year);
      return known && !known.allComarcas && !known.comarcas.some((name) => comarcaKey(name) === place.comarca);
    });
    if (missing.length > 0) assumptions.push({ code: "local_days_unchecked", years: missing });
  }
  for (const what of ["proceeding_kind", "system"] as const) {
    if (unsure[what].size > 0) assumptions.push({ code: "scope_unknown", what, days: [...unsure[what]].sort() });
  }

  return {
    ok: true,
    result: {
      rule: DEADLINE_RULE_VERSION,
      justice,
      trigger: input.trigger,
      triggerDay: input.on,
      publishedOn,
      fromDay: dayText(from),
      startsOn: dayText(starts),
      countedDueOn: dayText(last),
      dueOn: dayText(due),
      days: input.days,
      counting: input.counting,
      skipped: skipRanges(skipped, facts),
      moved,
      assumptions,
      checkedYears: years.flatMap((year) => {
        const known = checked.get(year);
        return known ? [{ year, checkedOn: known.checkedOn ?? null }] : [];
      }),
    },
  };
}

/**
 * The days that did not count, in ranges of one reason: a range made only of Saturdays and Sundays
 * is left out (they never count, and a holiday that falls on one changes nothing).
 */
function skipRanges(skipped: Map<number, Why>, facts: (number: number) => DayFacts): DeadlineSkip[] {
  const ranges: (DeadlineSkip & { start: number; end: number; weekdays: number })[] = [];
  for (const number of [...skipped.keys()].sort((a, b) => a - b)) {
    const why = skipped.get(number) as Why;
    if (why.reason === "weekend") continue;
    const weekday = facts(number).weekend ? 0 : 1;
    const open = ranges.at(-1);
    if (open && open.end === number - 1 && open.reason === why.reason && open.label === why.label) {
      open.end = number;
      open.to = dayText(number);
      open.weekdays += weekday;
    } else {
      ranges.push({
        from: dayText(number),
        to: dayText(number),
        reason: why.reason,
        label: why.label,
        start: number,
        end: number,
        weekdays: weekday,
      });
    }
  }
  return ranges
    .filter((range) => range.weekdays > 0)
    .map(({ from, to, reason, label }) => ({ from, to, reason, label }));
}

/**
 * The internal deadline (phase 8 of the plan of the controladoria and the finance): the given number of the court's
 * business days before the deadline, counted backward over the days the count itself saw (weekends, the national
 * holidays and the days the court was closed never count; a suspension of the terms, the year-end one included, is no
 * closure, and the firm works on it), and never before the first day of the term. Zero days is no internal deadline.
 * Pure.
 */
export function internalDeadline(
  result: Pick<DeadlineResult, "dueOn" | "startsOn" | "skipped">,
  days: number,
): string | null {
  if (!Number.isInteger(days) || days <= 0) return null;
  const due = dayNumber(result.dueOn);
  const first = dayNumber(result.startsOn);
  if (due === null || first === null) return null;
  const skipped: [number, number][] = [];
  for (const skip of result.skipped) {
    if (skip.reason !== "closed" && skip.reason !== "holiday") continue;
    const from = dayNumber(skip.from);
    const to = dayNumber(skip.to);
    if (from !== null && to !== null) skipped.push([from, to]);
  }
  let day = due;
  let counted = 0;
  while (counted < days && day > first) {
    day -= 1;
    const text = dayText(day);
    const weekday = weekdayOf(day);
    const off =
      weekday === 0 ||
      weekday === 6 ||
      nationalHoliday(text) !== null ||
      skipped.some(([from, to]) => day >= from && day <= to);
    if (!off) counted += 1;
  }
  return dayText(Math.max(day, first));
}

/**
 * The court's business day before a day (`sustentacao-v1`, 0219): counted backward over the court's calendar for the
 * lawsuit's place, passing weekends, the national holidays, the days the court was closed and the days of partial
 * business (a limit at an hour of the morning is never put on a day whose business starts later: the earlier day is
 * the safe one). A suspension of the terms is no closure: the court works on it. What it passed is said with its
 * label. Null for a day it cannot read, or with no business day within a year before it. Pure.
 */
export function businessDayBefore(
  on: string,
  calendar: CourtCalendar,
  place: DeadlinePlace,
): { day: string; passed: { day: string; label: string }[] } | null {
  const start = dayNumber(on);
  if (start === null || on < DEADLINE_FIRST_DAY || on > DEADLINE_LAST_DAY) return null;
  const where = {
    kind: place.proceedingKind || null,
    system: place.system || null,
    comarca: comarcaKey(place.comarca),
  };
  const passed: { day: string; label: string }[] = [];
  for (let number = start - 1; number >= start - 366; number -= 1) {
    const day = dayText(number);
    const weekday = weekdayOf(number);
    if (weekday === 0 || weekday === 6) continue;
    const holiday = nationalHoliday(day);
    if (holiday !== null) {
      passed.push({ day, label: holiday });
      continue;
    }
    const off = calendar.days.find(
      (entry) =>
        entry.day === day && (entry.kind === "closed" || entry.kind === "partial") && scopeOf(entry, where) !== "no",
    );
    if (off) {
      passed.push({ day, label: off.label });
      continue;
    }
    return { day, passed };
  }
  return null;
}
