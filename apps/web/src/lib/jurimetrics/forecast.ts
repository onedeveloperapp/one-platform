/**
 * The forecast of a lawsuit (migration 0250), as the screens read it: the cut nearest the case with the sample (the
 * judge, the unit, the comarca, the court, every court), the chance of winning, the moral damages' quartiles and the
 * values to place an offer among, how such lawsuits end, each level beside it, what the claimants may expect and what
 * the airline does at the unit. Every number comes from the database's one rule; this only reads it and places an
 * offer. Pure.
 */

export type ForecastLevel = "judge" | "unit" | "comarca" | "court" | "all";
export type ForecastBase = "pequena" | "media" | "solida";
export type ExtinctionReason =
  | "ausencia_autor"
  | "desistencia"
  | "reclamacao_previa"
  | "incompetencia"
  | "abandono"
  | "outro";

export type ForecastCut = {
  level: ForecastLevel;
  court: string | null;
  comarca: string | null;
  unit: string | null;
  judge: string | null;
  airline: string | null;
  problem: string;
};

export type Forecast = {
  cut: ForecastCut;
  decisions: number;
  merits: number;
  won: number;
  chancePercent: number | null;
  outcomes: { procedente: number; parcial: number; improcedente: number; acordo: number; extinto: number };
  base: ForecastBase;
  from: string | null;
  to: string | null;
  courts: string[];
  moral: { n: number; p25: number | null; median: number | null; p75: number | null; values: number[] };
  extinctions: Partial<Record<ExtinctionReason, number>>;
  months: { month: string; merits: number; won: number }[];
};

export type LevelRow = {
  level: ForecastLevel;
  cut: ForecastCut;
  merits: number;
  won: number;
  chancePercent: number | null;
  median: number | null;
};

export type CaseForecast = {
  proceedingId: string;
  stage: "before" | "distributed";
  problem: string | null;
  airline: string | null;
  court: string | null;
  comarca: string | null;
  unit: string | null;
  judge: string | null;
  claimants: number;
  forecast: Forecast | null;
  expectedCents: number | null;
  levels: LevelRow[];
  hearing: {
    level: "unit" | "comarca" | "court";
    decisions: number;
    acordo: number;
    extinto: number;
    reasons: Partial<Record<ExtinctionReason, number>>;
  } | null;
};

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const num = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
const maybe = (value: unknown): number | null =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const LEVELS: ForecastLevel[] = ["judge", "unit", "comarca", "court", "all"];
const REASONS: ExtinctionReason[] = [
  "ausencia_autor",
  "desistencia",
  "reclamacao_previa",
  "incompetencia",
  "abandono",
  "outro",
];

function cutOf(raw: unknown): ForecastCut {
  const row = obj(raw);
  const level = LEVELS.includes(row.level as ForecastLevel) ? (row.level as ForecastLevel) : "all";
  return {
    level,
    court: text(row.court),
    comarca: text(row.comarca),
    unit: text(row.unit),
    judge: text(row.judge),
    airline: text(row.airline),
    problem: text(row.problem) ?? "other",
  };
}

function reasonsOf(raw: unknown): Partial<Record<ExtinctionReason, number>> {
  const row = obj(raw);
  const out: Partial<Record<ExtinctionReason, number>> = {};
  for (const reason of REASONS) if (num(row[reason]) > 0) out[reason] = num(row[reason]);
  return out;
}

export function forecastOf(raw: unknown): Forecast | null {
  const row = obj(raw);
  if (!row.cut) return null;
  const outcomes = obj(row.outcomes);
  const moral = obj(row.moral);
  const base = row.base === "solida" || row.base === "media" ? row.base : "pequena";
  return {
    cut: cutOf(row.cut),
    decisions: num(row.decisions),
    merits: num(row.merits),
    won: num(row.won),
    chancePercent: maybe(row.chance_percent),
    outcomes: {
      procedente: num(outcomes.procedente),
      parcial: num(outcomes.parcial),
      improcedente: num(outcomes.improcedente),
      acordo: num(outcomes.acordo),
      extinto: num(outcomes.extinto),
    },
    base,
    from: text(row.from),
    to: text(row.to),
    courts: Array.isArray(row.courts) ? row.courts.filter((court): court is string => typeof court === "string") : [],
    moral: {
      n: num(moral.n),
      p25: maybe(moral.p25_cents),
      median: maybe(moral.median_cents),
      p75: maybe(moral.p75_cents),
      values: Array.isArray(moral.values)
        ? moral.values
            .map(Number)
            .filter((value) => Number.isFinite(value) && value > 0)
            .sort((a, b) => a - b)
        : [],
    },
    extinctions: reasonsOf(row.extinctions),
    months: Array.isArray(row.months)
      ? row.months.map((item) => {
          const month = obj(item);
          return { month: String(month.month ?? ""), merits: num(month.merits), won: num(month.won) };
        })
      : [],
  };
}

export function caseForecastOf(raw: unknown): CaseForecast | null {
  const row = obj(raw);
  if (typeof row.proceeding !== "string") return null;
  const hearing = obj(row.hearing);
  const hearingLevel =
    hearing.level === "unit" || hearing.level === "comarca" || hearing.level === "court" ? hearing.level : null;
  return {
    proceedingId: row.proceeding,
    stage: row.stage === "distributed" ? "distributed" : "before",
    problem: text(row.problem),
    airline: text(row.airline),
    court: text(row.court),
    comarca: text(row.comarca),
    unit: text(row.unit),
    judge: text(row.judge),
    claimants: num(row.claimants),
    forecast: forecastOf(row.forecast),
    expectedCents: maybe(row.expected_cents),
    levels: Array.isArray(row.levels)
      ? row.levels.map((item) => {
          const level = obj(item);
          return {
            level: cutOf(level.cut).level,
            cut: cutOf(level.cut),
            merits: num(level.merits),
            won: num(level.won),
            chancePercent: maybe(level.chance_percent),
            median: maybe(level.median_cents),
          };
        })
      : [],
    hearing: hearingLevel
      ? {
          level: hearingLevel,
          decisions: num(hearing.decisions),
          acordo: num(hearing.acordo),
          extinto: num(hearing.extinto),
          reasons: reasonsOf(hearing.reasons),
        }
      : null,
  };
}

/**
 * Where an offer falls among the moral damages the cut set: how many were the offer or more. A value the rule cannot
 * place (no values, no offer) is null; the screen then says nothing of it.
 */
export function offerPlace(values: number[], offerCents: number | null): { atOrAbove: number; of: number } | null {
  if (!offerCents || offerCents <= 0 || values.length === 0) return null;
  return { atOrAbove: values.filter((value) => value >= offerCents).length, of: values.length };
}

/**
 * The share said in words a person reads at a glance: "2 em cada 3", "3 em cada 4", "9 em cada 10", the nearest of
 * the plain fractions, never a decimal; null for a share too small or too whole to say so.
 */
export function shareWords(part: number, whole: number): { part: number; of: number } | null {
  if (whole <= 0 || part <= 0 || part >= whole) return null;
  const share = part / whole;
  const plain: [number, number][] = [
    [1, 10],
    [1, 5],
    [1, 4],
    [1, 3],
    [2, 5],
    [1, 2],
    [3, 5],
    [2, 3],
    [3, 4],
    [4, 5],
    [9, 10],
  ];
  let best = plain[0];
  for (const candidate of plain) {
    if (Math.abs(candidate[0] / candidate[1] - share) < Math.abs(best[0] / best[1] - share)) best = candidate;
  }
  return { part: best[0], of: best[1] };
}

/** Each month's chance, for the trend: only the months with the sample, oldest first. */
export function monthlyChance(months: Forecast["months"], minSample = 5): { month: string; percent: number }[] {
  return months
    .filter((item) => item.merits >= minSample)
    .map((item) => ({ month: item.month, percent: Math.round((100 * item.won) / item.merits) }));
}

/** Whether the forecast says something worth a card: a chance with its sample. */
export function hasForecast(read: CaseForecast | null): read is CaseForecast & { forecast: Forecast } {
  return Boolean(read?.forecast && read.forecast.chancePercent !== null);
}
