import { addDays, localOf, weekdayNumber } from "@/lib/agenda/agenda";
import type { WeeklyDigestFacts } from "@flyee/email";

/**
 * The partner's weekly digest (migration 0200), the pure half: the facts of a week read from the database's answer,
 * whether a moment is the Monday morning it goes, and the week said in the reader's words.
 */

const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const count = (value: unknown): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

const part = (raw: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = raw[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
};

/** The facts of a week as `weekly_digest_facts` answers them; null for an answer that is not one. */
export function readWeeklyFacts(raw: unknown): (WeeklyDigestFacts & { week: string }) | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const facts = raw as Record<string, unknown>;
  if (typeof facts.week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(facts.week)) return null;
  const cases = part(facts, "cases");
  const outcomes = part(facts, "outcomes");
  const ahead = part(facts, "ahead");
  const waiting = part(facts, "waiting");
  const one = part(facts, "one");
  return {
    week: facts.week,
    testsCounted: facts.tests_counted === true,
    cases: {
      opened: count(cases.opened),
      openedBefore: count(cases.opened_before),
      closings: count(cases.closings),
      closingsBefore: count(cases.closings_before),
      filed: count(cases.filed),
      filedBefore: count(cases.filed_before),
      ended: count(cases.ended),
      endedBefore: count(cases.ended_before),
      going: count(cases.going),
    },
    outcomes: {
      won: count(outcomes.won),
      partial: count(outcomes.partial),
      lost: count(outcomes.lost),
      settlements: count(outcomes.settlements),
      final: count(outcomes.final),
      received: count(outcomes.received),
      receivedCents: count(outcomes.received_cents),
    },
    ahead: { deadlines: count(ahead.deadlines), hearings: count(ahead.hearings) },
    waiting: {
      overdue: count(waiting.overdue),
      stagnant: count(waiting.stagnant),
      decisions: count(waiting.decisions),
      awareness: count(waiting.awareness),
    },
    one: { tasks: count(one.tasks), minutes: count(one.minutes) },
  };
}

/**
 * Whether a moment is the Monday morning of Brasília the digest goes (from 7 to noon), and the Monday of the week
 * before it, which the digest tells.
 */
export function weeklyDue(now: Date): { week: string; due: boolean } {
  const local = localOf(now.toISOString(), "America/Sao_Paulo");
  const hour = Number.parseInt(local.time.slice(0, 2), 10);
  const weekday = weekdayNumber(local.day);
  const monday = addDays(local.day, -((weekday + 6) % 7));
  return { week: addDays(monday, -7), due: weekday === 1 && hour >= 7 && hour < 12 };
}

/** "2 a 8 de novembro", or "27 de outubro a 2 de novembro" across two months. */
export function weekLabel(week: string): string {
  const end = addDays(week, 6);
  const dayOf = (day: string) => Number.parseInt(day.slice(8, 10), 10);
  const monthOf = (day: string) => MONTHS[Number.parseInt(day.slice(5, 7), 10) - 1] ?? "";
  return monthOf(week) === monthOf(end)
    ? `${dayOf(week)} a ${dayOf(end)} de ${monthOf(end)}`
    : `${dayOf(week)} de ${monthOf(week)} a ${dayOf(end)} de ${monthOf(end)}`;
}

/** Where each part of the digest leads in ONE. */
export const weeklyLinks = (siteUrl: string) => ({
  cases: `${siteUrl}/controladoria`,
  outcomes: `${siteUrl}/numeros`,
  ahead: `${siteUrl}/agenda?modo=semana`,
  waiting: `${siteUrl}/inicio`,
  one: `${siteUrl}/trabalho-do-one`,
});
