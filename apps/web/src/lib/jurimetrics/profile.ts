/**
 * What the screens say of the market's numbers (migration 0190): each number with its sample, and nothing of fewer than
 * the setting's five said as a rate or a median. Pure.
 */

export type MarketNumbers = {
  decisions: number;
  merits: number;
  won: number;
  successPercent: number | null;
  settlements: number;
  extinct: number;
  priorComplaint: number;
  priorComplaintPercent: number | null;
  /** The median moral damages by kind of problem, each with how many decisions set one. */
  moral: { problem: string; n: number; medianCents: number | null }[];
  from: string | null;
  to: string | null;
  minSample: number;
  thesesReleased: boolean;
  theses: { slug: string; name: string; side: "favor" | "contra"; n: number }[] | null;
};

const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
const maybe = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function marketNumbersOf(raw: unknown): MarketNumbers | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const moral =
    row.moral && typeof row.moral === "object" && !Array.isArray(row.moral)
      ? Object.entries(row.moral as Record<string, { n?: unknown; median_cents?: unknown }>).map(
          ([problem, value]) => ({
            problem,
            n: num(value?.n),
            medianCents: maybe(value?.median_cents),
          }),
        )
      : [];
  return {
    decisions: num(row.decisions),
    merits: num(row.merits),
    won: num(row.won),
    successPercent: maybe(row.success_percent),
    settlements: num(row.settlements),
    extinct: num(row.extinct),
    priorComplaint: num(row.prior_complaint),
    priorComplaintPercent: maybe(row.prior_complaint_percent),
    moral: moral.sort((a, b) => b.n - a.n),
    from: typeof row.from === "string" ? row.from : null,
    to: typeof row.to === "string" ? row.to : null,
    minSample: num(row.min_sample) || 5,
    thesesReleased: row.theses_released === true,
    theses: Array.isArray(row.theses)
      ? (row.theses as Record<string, unknown>[]).flatMap((item) =>
          typeof item.slug === "string" && typeof item.name === "string"
            ? [
                {
                  slug: item.slug,
                  name: item.name,
                  side: item.side === "contra" ? "contra" : "favor",
                  n: num(item.n),
                } as const,
              ]
            : [],
        )
      : null,
  };
}

/** The problems' words of the market, as the screens name them. */
export const MARKET_PROBLEM_KEY: Record<string, string> = {
  delay: "market-problem-delay",
  cancellation: "market-problem-cancellation",
  overbooking: "market-problem-overbooking",
  baggage: "market-problem-baggage",
  other: "market-problem-other",
};

export const brl = (cents: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
