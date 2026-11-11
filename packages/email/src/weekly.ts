import { emailCopyFor } from "./copy";
import type { EmailLocale } from "./locale";

/**
 * The facts of a firm's week (migration 0200), as the weekly digest tells them: counts and one sum of money, never a
 * client, a lawsuit's number or a case's value.
 */
export type WeeklyDigestFacts = {
  testsCounted: boolean;
  cases: {
    opened: number;
    openedBefore: number;
    closings: number;
    closingsBefore: number;
    filed: number;
    filedBefore: number;
    ended: number;
    endedBefore: number;
    going: number;
  };
  outcomes: { won: number; partial: number; lost: number; settlements: number; final: number; received: number; receivedCents: number };
  ahead: { deadlines: number; hearings: number };
  waiting: { overdue: number; stagnant: number; decisions: number; awareness: number };
  one: { tasks: number; minutes: number };
};

/** Where each part of the digest leads in ONE. */
export type WeeklyDigestLinks = { cases: string; outcomes: string; ahead: string; waiting: string; one: string };

export type WeeklyDigestSection = { key: keyof WeeklyDigestLinks; title: string; url: string; lines: string[] };

const money = (cents: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100).replace(/ /g, " ");

/**
 * The parts of the digest in the reader's words, each line a count that is not zero (a missing value hides its line),
 * a part with nothing said as such. The e-mail and the person's settings read the same words.
 */
export function weeklyDigestSections(
  locale: EmailLocale,
  facts: WeeklyDigestFacts,
  links: WeeklyDigestLinks,
): WeeklyDigestSection[] {
  const copy = emailCopyFor(locale).weeklyDigest;
  const withBefore = (now: number, before: number, words: (n: number) => string): string | null =>
    now === 0 && before === 0 ? null : `${words(now)} (${copy.before(before)})`;
  const only = (n: number, words: (n: number) => string): string | null => (n > 0 ? words(n) : null);
  const { cases, outcomes, ahead, waiting, one } = facts;
  const parts: { key: keyof WeeklyDigestLinks; title: string; lines: (string | null)[] }[] = [
    {
      key: "cases",
      title: copy.casesTitle,
      lines: [
        withBefore(cases.opened, cases.openedBefore, copy.opened),
        withBefore(cases.closings, cases.closingsBefore, copy.closings),
        withBefore(cases.filed, cases.filedBefore, copy.filed),
        withBefore(cases.ended, cases.endedBefore, copy.ended),
        only(cases.going, copy.going),
      ],
    },
    {
      key: "outcomes",
      title: copy.outcomesTitle,
      lines: [
        only(outcomes.won, copy.won),
        only(outcomes.partial, copy.partial),
        only(outcomes.lost, copy.lost),
        only(outcomes.settlements, copy.settlements),
        only(outcomes.final, copy.final),
        outcomes.received > 0 ? copy.received(outcomes.received, money(outcomes.receivedCents)) : null,
      ],
    },
    {
      key: "ahead",
      title: copy.aheadTitle,
      lines: [only(ahead.deadlines, copy.deadlines), only(ahead.hearings, copy.hearings)],
    },
    {
      key: "waiting",
      title: copy.waitingTitle,
      lines: [
        only(waiting.overdue, copy.overdue),
        only(waiting.stagnant, copy.stagnant),
        only(waiting.decisions, copy.decisions),
        only(waiting.awareness, copy.awareness),
      ],
    },
    {
      key: "one",
      title: copy.oneTitle,
      lines: [one.tasks > 0 ? copy.one(one.tasks, copy.hours(one.minutes)) : null],
    },
  ];
  return parts.map((part) => {
    const lines = part.lines.filter((line): line is string => Boolean(line));
    return { key: part.key, title: part.title, url: links[part.key], lines: lines.length > 0 ? lines : [copy.nothing] };
  });
}

/**
 * How many things the week tells: what happened in it, what this week holds, what waits and what ONE did (the cases
 * going alone are no news). A week of nothing sends no e-mail.
 */
export function weeklyDigestItems(facts: WeeklyDigestFacts): number {
  const { cases, outcomes, ahead, waiting, one } = facts;
  return (
    cases.opened +
    cases.closings +
    cases.filed +
    cases.ended +
    outcomes.won +
    outcomes.partial +
    outcomes.lost +
    outcomes.settlements +
    outcomes.final +
    outcomes.received +
    ahead.deadlines +
    ahead.hearings +
    waiting.overdue +
    waiting.stagnant +
    waiting.decisions +
    waiting.awareness +
    one.tasks
  );
}
