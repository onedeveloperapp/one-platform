import type { CaseFilter, CaseNumbers } from "@/lib/cases/list";
import { type Compared, compared, type Hope } from "@/lib/numbers/compare";

/**
 * The cards above the list of cases (the screen pattern of phase 0, 0108): each number with what it was in the
 * same days of the month before, and the view of the list it counts, so a card opens the very list whose count it
 * shows. Pure.
 */
export type CaseCardKey = "going" | "opened" | "filed" | "ended";

export type CaseCard = {
  key: CaseCardKey;
  /** The view of the list the card counts (null: the cases still going, the list's own). */
  view: CaseFilter | null;
  value: number;
  before: number;
  compared: Compared;
  /** The move the card hopes for: more cases opened and filed. A stock, or cases ended (some did not go on), none. */
  hope: Hope;
  /** What it is compared with: the end of one day of the month before, or the same days of it. */
  span: "day" | "days";
};

export function caseCards(numbers: CaseNumbers): CaseCard[] {
  const card = (
    key: CaseCardKey,
    view: CaseFilter | null,
    value: number,
    before: number,
    hope: Hope,
    span: CaseCard["span"],
  ): CaseCard => ({ key, view, value, before, compared: compared(value, before), hope, span });
  return [
    card("going", null, numbers.going, numbers.goingBefore, null, "day"),
    card("opened", "novos-mes", numbers.opened, numbers.openedBefore, "up", "days"),
    card("filed", "ajuizados-mes", numbers.filed, numbers.filedBefore, "up", "days"),
    card("ended", "encerrados-mes", numbers.ended, numbers.endedBefore, null, "days"),
  ];
}

const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });
const dayOf = (day: string) => new Date(`${day}T00:00:00Z`);

/** A day as a person says it: "7 de outubro". */
export const dayMonthText = (day: string): string => DAY_MONTH.format(dayOf(day));

/**
 * The days a card compares with: the same day of the month before ("7 de outubro"), or the same days of it
 * ("1 a 7 de outubro"; "1 de outubro" on the first of the month).
 */
export function spanText(numbers: CaseNumbers, span: CaseCard["span"]): string {
  if (span === "day" || numbers.beforeSince === numbers.beforeUntil) return dayMonthText(numbers.beforeUntil);
  return `${dayOf(numbers.beforeSince).getUTCDate()} a ${dayMonthText(numbers.beforeUntil)}`;
}
