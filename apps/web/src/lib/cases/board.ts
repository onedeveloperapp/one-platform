import { JOURNEY_STEPS, type JourneyStepId, OPEN_STEPS } from "@/lib/cases/journey";

/**
 * The board of the controladoria by step (`firm_case_board`, migration 0112), only to look at: a column per step of
 * the way, each with how many cases are at it, how many stagnated and its first cases, the longest at the step first.
 * Who has each case and its step are the rule of the top of the case (`case_standing`, 0111). Pure: the answer read,
 * the columns in the order of the way, and the next cases of a column put after the ones shown.
 */

/** How many cases a column shows at a time. */
export const BOARD_PAGE = 10;

export type BoardItem = {
  id: string;
  seq: number;
  /** The first adult claimant, else who answers for a minor; empty when the case has nobody yet. */
  client: string;
  holder: string | null;
  why: string | null;
  /** Whole days of Brasília at the step. */
  days: number;
  stagnant: boolean;
};

export type BoardColumn = {
  step: JourneyStepId;
  /** Every case at the step, shown or not. */
  cases: number;
  stagnant: number;
  /** The setting's days of the step; null where it has none. */
  limit: number | null;
  items: BoardItem[];
};

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

const isStep = (value: unknown): value is JourneyStepId => (JOURNEY_STEPS as readonly unknown[]).includes(value);

function itemOf(raw: unknown): BoardItem[] {
  if (typeof raw !== "object" || raw === null) return [];
  const item = raw as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.seq !== "number") return [];
  return [
    {
      id: item.id,
      seq: item.seq,
      client: typeof item.client === "string" ? item.client : "",
      holder: typeof item.holder === "string" ? item.holder : null,
      why: typeof item.why === "string" ? item.why : null,
      days: whole(item.days),
      stagnant: item.stagnant === true,
    },
  ];
}

/**
 * The answer of `firm_case_board`, read: its columns, a step this code does not know left out (a newer database);
 * null when it is not one (a read that failed is never an empty board).
 */
export function caseBoardOf(raw: unknown): BoardColumn[] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const columns = (raw as Record<string, unknown>).columns;
  if (!Array.isArray(columns)) return null;
  return columns.flatMap((entry): BoardColumn[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const column = entry as Record<string, unknown>;
    if (!isStep(column.step)) return [];
    return [
      {
        step: column.step,
        cases: whole(column.cases),
        stagnant: whole(column.stagnant),
        limit: typeof column.limit === "number" && Number.isFinite(column.limit) ? column.limit : null,
        items: Array.isArray(column.items) ? column.items.flatMap(itemOf) : [],
      },
    ];
  });
}

/**
 * The columns the board shows, in the order of the way: every step a case in progress may be at (a step with none is
 * an empty column, so the way reads whole), and the last one only while a case is there (its money released and
 * nobody archived it yet).
 */
export function boardColumns(columns: BoardColumn[]): BoardColumn[] {
  const of = new Map(columns.map((column) => [column.step, column]));
  const steps: JourneyStepId[] = of.get("closed") ? [...OPEN_STEPS, "closed"] : [...OPEN_STEPS];
  return steps.map((step) => of.get(step) ?? { step, cases: 0, stagnant: 0, limit: null, items: [] });
}

/** A column with its next cases put after the ones shown, each case once, and its counts as the latest read says. */
export function withMore(column: BoardColumn, next: BoardColumn): BoardColumn {
  const shown = new Set(column.items.map((item) => item.id));
  return {
    ...next,
    items: [...column.items, ...next.items.filter((item) => !shown.has(item.id))],
  };
}

/** How many cases of a column are not shown yet. */
export const hiddenOf = (column: BoardColumn): number => Math.max(0, column.cases - column.items.length);
