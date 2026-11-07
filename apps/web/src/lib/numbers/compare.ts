/**
 * How a number stands against what it was (the number cards of the screen pattern, phase 0 of the plan of
 * 2026-11-07). Pure. A number is compared only with the same span (the same days of the month before, the same
 * day), never a few days with a whole month: who reads "+9%" reads a real move.
 */

/** From what size a change is said as a share of what it was; below it, the difference itself says more. */
export const PERCENT_FROM = 20;

export type Move = "up" | "down" | "same";

export type Compared = {
  move: Move;
  /** Now less before. */
  difference: number;
  /** The difference as a whole share of what it was; null when what it was is too small to say it so. */
  percent: number | null;
};

export function compared(now: number, before: number): Compared {
  const difference = now - before;
  const move: Move = difference > 0 ? "up" : difference < 0 ? "down" : "same";
  const share = before >= PERCENT_FROM ? Math.round((difference / before) * 100) : null;
  // A share that rounds to nothing is said as the difference, which is not nothing.
  return { move, difference, percent: share === 0 && difference !== 0 ? null : share };
}

/** The move in a few characters: "+9%", "-4", "+1"; null when nothing moved. */
export function deltaText(value: Compared): string | null {
  if (value.move === "same") return null;
  const sign = value.difference > 0 ? "+" : "-";
  return value.percent !== null
    ? `${sign}${Math.abs(value.percent)}%`
    : `${sign}${Math.abs(value.difference).toLocaleString("pt-BR")}`;
}

/** Whether a move is the one a card hopes for (more cases filed, more cases ended); a rise of a stock is neither. */
export type Hope = "up" | "down" | null;

export const isHoped = (value: Compared, hope: Hope): boolean => hope !== null && value.move === hope;

/** A count as Brazil writes it: 1.284. */
export const countText = (value: number): string => value.toLocaleString("pt-BR");
