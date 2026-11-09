import { type JourneyStepId, OPEN_STEPS } from "@/lib/cases/journey";
import type { CaseListQuery, StandingView } from "@/lib/cases/list";

/**
 * Who has each case of the list and why, as the database says it (`case_standing`, migration 0111: the rule of the
 * top of the case over every case, compared with it case by case by `standing.db.test.ts`). Pure: the views of the
 * list by who has the case, and the words of each reason, short enough for a line of a list.
 */

export type Holder = "firm" | "client" | "one" | "court" | "platform";
export const HOLDERS: readonly Holder[] = ["firm", "client", "one", "court", "platform"];
export const isHolder = (value: unknown): value is Holder => (HOLDERS as readonly unknown[]).includes(value);

/** The view of the list each holder opens. */
export const HOLDER_VIEW: Record<Holder, StandingView> = {
  firm: "com-escritorio",
  client: "com-cliente",
  one: "com-one",
  court: "no-tribunal",
  platform: "com-plataforma",
};

/** The reasons the database gives, by holder (each has its words); a wait ONE recorded is `wait:<code>`. */
export const REASONS: Record<Holder, readonly string[]> = {
  firm: [
    "account_failed",
    "signature_failed",
    "piece_failed",
    "filing_failed",
    "deadline_overdue",
    "documents",
    "civil_declined",
    "account_proposed",
    "link",
    "signature_check",
    "system_unapproved",
    "power_unnamed",
    "piece_review",
    "filing",
    "deadline_confirm",
    "deadline_review",
    "hearing_silent",
    "publication_triage",
    "publication_ack",
    "judgment_ask",
    "reading_left",
    "payment",
    "complaint",
  ],
  one: [
    "one_looking",
    "one_due",
    "documents",
    "account",
    "link",
    "signature",
    "piece",
    "filing",
    "publication_triage",
    "reading",
  ],
  client: ["lacks", "civil_unanswered", "account", "link", "signature", "piece_asking", "filing"],
  platform: ["system", "filing"],
  court: [],
};

/**
 * The message key of why a case is with whom it is: one of the reasons above, or, for a wait ONE recorded, the
 * holder's general words of it; null when there is nothing to say (a case in court with nothing to do).
 */
export function reasonKey(holder: string | null | undefined, why: string | null | undefined): string | null {
  if (!isHolder(holder) || !why) return null;
  if (why.startsWith("wait:")) return holder === "court" ? null : `standing-why-${holder}-wait`;
  return REASONS[holder].includes(why) ? `standing-why-${holder}-${why}` : null;
}

/** Every message key the reasons may need, spelled out for the catalog check. */
export const REASON_KEYS: readonly string[] = HOLDERS.flatMap((holder) => [
  ...REASONS[holder].map((why) => `standing-why-${holder}-${why}`),
  ...(holder === "court" ? [] : [`standing-why-${holder}-wait`]),
]);

/** One step of the stock (`firm_case_stock`): its cases, the stagnant ones, the median and the most days, its limit. */
export type StockStep = {
  step: string;
  cases: number;
  stagnant: number;
  medianDays: number;
  oldestDays: number;
  limit: number | null;
};

/** The firm's stock as the controladoria reads it. */
export type CaseStock = { steps: StockStep[]; holders: Record<Holder, number>; stagnant: number; total: number };

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** The answer of `firm_case_stock`, read; null when it is not one (a read that failed is never an empty stock). */
export function caseStockOf(raw: unknown): CaseStock | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.steps) || typeof value.holders !== "object" || value.holders === null) return null;
  const holders = value.holders as Record<string, unknown>;
  return {
    steps: (value.steps as unknown[]).flatMap((item): StockStep[] => {
      const row = (item ?? {}) as Record<string, unknown>;
      if (typeof row.step !== "string") return [];
      return [
        {
          step: row.step,
          cases: whole(row.cases),
          stagnant: whole(row.stagnant),
          medianDays: whole(row.median_days),
          oldestDays: whole(row.oldest_days),
          limit: typeof row.limit === "number" && Number.isFinite(row.limit) ? row.limit : null,
        },
      ];
    }),
    holders: Object.fromEntries(HOLDERS.map((holder) => [holder, whole(holders[holder])])) as Record<Holder, number>,
    stagnant: whole(value.stagnant),
    total: whole(value.total),
  };
}

/**
 * How many cases each view of who has the case lists, from the stock read under the list's own scope and filters
 * (the module, the kind of problem, the airline): the list never reads who has every case to count them, the stock
 * does, once a load.
 */
export function standingCounts(stock: CaseStock): Record<StandingView, number> {
  return {
    ...(Object.fromEntries(HOLDERS.map((holder) => [HOLDER_VIEW[holder], stock.holders[holder]])) as Record<
      Exclude<StandingView, "estagnados">,
      number
    >),
    estagnados: stock.stagnant,
  };
}

/** The scope a stock is read under (the module, the kind of problem, the airline), as one key: a new one reads it again. */
export const stockKey = (query: Pick<CaseListQuery, "module" | "incident" | "airline" | "tests">): string =>
  [query.module ?? "", query.incident ?? "", query.airline ?? "", query.tests === false ? "real" : "all"].join("|");

/**
 * The steps the stock shows, in the order of the way: every step a case in progress may be at, and the last one only
 * while a case is there (its money released and nobody archived it yet), so the steps add up to the stock.
 */
export function stockSteps(stock: CaseStock | null): JourneyStepId[] {
  const closing = stock?.steps.some((item) => item.step === "closed" && item.cases > 0) ?? false;
  return closing ? [...OPEN_STEPS, "closed"] : [...OPEN_STEPS];
}
