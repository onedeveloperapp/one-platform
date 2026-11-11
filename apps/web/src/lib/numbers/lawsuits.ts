/**
 * The firm's numbers (migration 0136), as pure rules over the one set behind all of them: each lawsuit filed, grouped by
 * a dimension, each number with its sample and the lawsuits behind it, no average of fewer than five, and the cohorts by
 * the month a lawsuit was filed. What ONE read and nobody checked is counted, and may be left out.
 */

import { type FactClaim, factClaimsOf } from "@/lib/cases/outcomes";
import { CLAIM_KINDS, type ClaimKind } from "@flyee/rules/outcome";

export type LawsuitRow = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  cnj: string;
  airline: string | null;
  incident: string | null;
  court: string;
  comarca: string | null;
  /** The vara or juizado the court records (0168). */
  unit: string | null;
  kind: string;
  filedOn: string;
  openedOn: string | null;
  result: "procedente" | "parcial" | "improcedente" | null;
  judgedOn: string | null;
  judgedChecked: boolean;
  valueCents: number | null;
  settled: boolean;
  final: boolean;
  paidOn: string | null;
  closed: boolean;
  unchecked: number;
  isTest: boolean;
  /** What its judgment decided of each claim (0193), and how many claimants it has. */
  claims: FactClaim[];
  claimants: number;
};

export const DIMENSIONS = ["airline", "incident", "court", "comarca", "unit", "kind"] as const;
export type Dimension = (typeof DIMENSIONS)[number];

/** No average, median or rate of fewer than this many lawsuits. */
export const MIN_SAMPLE = 5;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const DAY = /^\d{4}-\d{2}-\d{2}/;

export function readLawsuitRows(raw: unknown): LawsuitRow[] {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(answer.rows) ? answer.rows : [];
  return rows.flatMap((item): LawsuitRow[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const id = text(row.id);
    const filed = text(row.filed_on);
    if (!id || !filed || !DAY.test(filed)) return [];
    const result =
      row.result === "procedente" || row.result === "parcial" || row.result === "improcedente" ? row.result : null;
    return [
      {
        id,
        caseId: text(row.case_id) ?? "",
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        cnj: text(row.cnj) ?? "",
        airline: text(row.airline),
        incident: text(row.incident),
        court: text(row.court) ?? "",
        comarca: text(row.comarca),
        unit: text(row.unit),
        kind: text(row.kind) ?? "",
        filedOn: filed.slice(0, 10),
        openedOn: text(row.opened_on)?.slice(0, 10) ?? null,
        result,
        judgedOn: text(row.judged_on)?.slice(0, 10) ?? null,
        judgedChecked: row.judged_checked === true,
        valueCents: typeof row.value_cents === "number" ? row.value_cents : null,
        settled: row.settled === true,
        final: row.final === true,
        paidOn: text(row.paid_on)?.slice(0, 10) ?? null,
        closed: row.closed === true,
        unchecked: typeof row.unchecked === "number" ? row.unchecked : 0,
        isTest: row.is_test === true,
        claims: factClaimsOf(row.claims),
        claimants: typeof row.claimants === "number" && row.claimants > 0 ? row.claimants : 1,
      },
    ];
  });
}

const days = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** The median of a list, or null with fewer than the sample. */
export function median(values: readonly number[]): number | null {
  if (values.length < MIN_SAMPLE) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** A judgment the numbers count: any, or only one a person checked. */
const judgment = (row: LawsuitRow, checkedOnly: boolean) =>
  row.result && (!checkedOnly || row.judgedChecked) ? row.result : null;

export type Stats = {
  key: string;
  lawsuits: number;
  judged: number;
  won: number;
  partial: number;
  lost: number;
  settled: number;
  /** Won in whole or in part, of the judged; null with fewer than the sample. */
  successRate: number | null;
  valuePerClaimant: number | null;
  daysToJudgment: number | null;
  daysToMoney: number | null;
  /** The firm's own time: from the case opening to the filing. */
  daysToFiling: number | null;
  unchecked: number;
  ids: string[];
};

export function statsOf(key: string, rows: readonly LawsuitRow[], checkedOnly: boolean): Stats {
  const judged = rows.filter((row) => judgment(row, checkedOnly) !== null);
  const won = judged.filter((row) => judgment(row, checkedOnly) === "procedente").length;
  const partial = judged.filter((row) => judgment(row, checkedOnly) === "parcial").length;
  const values = judged
    .filter((row) => judgment(row, checkedOnly) !== "improcedente" && row.valueCents !== null && row.valueCents > 0)
    .map((row) => row.valueCents!);
  return {
    key,
    lawsuits: rows.length,
    judged: judged.length,
    won,
    partial,
    lost: judged.length - won - partial,
    settled: rows.filter((row) => row.settled).length,
    successRate: judged.length >= MIN_SAMPLE ? (won + partial) / judged.length : null,
    valuePerClaimant:
      values.length >= MIN_SAMPLE ? Math.round(values.reduce((acc, value) => acc + value, 0) / values.length) : null,
    daysToJudgment: median(judged.filter((row) => row.judgedOn).map((row) => days(row.filedOn, row.judgedOn!))),
    daysToMoney: median(rows.filter((row) => row.paidOn).map((row) => days(row.filedOn, row.paidOn!))),
    daysToFiling: median(
      rows.filter((row) => row.openedOn).map((row) => Math.max(days(row.openedOn!, row.filedOn), 0)),
    ),
    unchecked: rows.reduce((acc, row) => acc + row.unchecked, 0),
    ids: rows.map((row) => row.id),
  };
}

const keyOf = (row: LawsuitRow, dimension: Dimension): string =>
  (dimension === "airline"
    ? row.airline
    : dimension === "incident"
      ? row.incident
      : dimension === "court"
        ? row.court
        : dimension === "comarca"
          ? row.comarca
          : dimension === "unit"
            ? row.unit
            : row.kind) ?? "";

/** How the judgments decided one claim (0193): of the judged lawsuits that decided it, how many granted and for how much. */
export type ClaimStats = {
  claim: ClaimKind;
  /** The judged lawsuits whose judgment decided this claim. */
  decided: number;
  granted: number;
  /** Granted, of the decided; null with fewer than the sample. */
  grantRate: number | null;
  /** The median value granted per claimant; null with fewer than the sample of values. */
  valuePerClaimant: number | null;
  ids: string[];
};

/** Each claim the judgments decided, in the order of the kinds, those no judgment decided left out (0193). */
export function claimStats(rows: readonly LawsuitRow[], checkedOnly: boolean): ClaimStats[] {
  return CLAIM_KINDS.flatMap((kind): ClaimStats[] => {
    const decided = rows.flatMap((row) => {
      if (!judgment(row, checkedOnly)) return [];
      const claim = row.claims.find((item) => item.claim === kind);
      return claim ? [{ row, claim }] : [];
    });
    if (decided.length === 0) return [];
    const granted = decided.filter((item) => item.claim.result === "concedido");
    const values = granted
      .filter((item) => item.claim.cents !== null)
      .map((item) =>
        item.claim.perClaimant
          ? (item.claim.cents as number)
          : Math.round((item.claim.cents as number) / Math.max(item.row.claimants, 1)),
      );
    return [
      {
        claim: kind,
        decided: decided.length,
        granted: granted.length,
        grantRate: decided.length >= MIN_SAMPLE ? granted.length / decided.length : null,
        valuePerClaimant: median(values),
        ids: decided.map((item) => item.row.id),
      },
    ];
  });
}

/** The rows of a period: filed from `from` to `to`, both optional. */
export const withinPeriod = (rows: readonly LawsuitRow[], from: string | null, to: string | null): LawsuitRow[] =>
  rows.filter((row) => (!from || row.filedOn >= from) && (!to || row.filedOn <= to));

/** Each group of a dimension with its numbers, the largest first; a group with no key is "" (not recorded). */
export function groupStats(rows: readonly LawsuitRow[], dimension: Dimension, checkedOnly: boolean): Stats[] {
  const groups = new Map<string, LawsuitRow[]>();
  for (const row of rows) {
    const key = keyOf(row, dimension);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, list]) => statsOf(key, list, checkedOnly))
    .sort((a, b) => b.lawsuits - a.lawsuits || a.key.localeCompare(b.key));
}

export type Cohort = {
  month: string;
  filed: number;
  judged: number;
  final: number;
  executing: number;
  paid: number;
  closed: number;
  success: number;
  lost: number;
};

/** The cohorts by the month a lawsuit was filed, the latest first. */
export function cohorts(rows: readonly LawsuitRow[], checkedOnly: boolean): Cohort[] {
  const months = new Map<string, LawsuitRow[]>();
  for (const row of rows) months.set(row.filedOn.slice(0, 7), [...(months.get(row.filedOn.slice(0, 7)) ?? []), row]);
  return [...months.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, list]) => ({
      month,
      filed: list.length,
      judged: list.filter((row) => judgment(row, checkedOnly) !== null).length,
      final: list.filter((row) => row.final).length,
      executing: list.filter((row) => row.final && !row.paidOn).length,
      paid: list.filter((row) => row.paidOn !== null).length,
      closed: list.filter((row) => row.closed).length,
      success: list.filter((row) => {
        const result = judgment(row, checkedOnly);
        return result === "procedente" || result === "parcial" || row.settled;
      }).length,
      lost: list.filter((row) => judgment(row, checkedOnly) === "improcedente").length,
    }));
}

export type Margin = {
  caseId: string;
  caseSeq: number | null;
  feesCents: number;
  costsCents: number;
  marginCents: number;
};

export function readMargins(raw: unknown): Margin[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): Margin[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const caseId = text(row.case_id);
    if (!caseId) return [];
    const whole = (value: unknown) => (typeof value === "number" ? Math.trunc(value) : 0);
    return [
      {
        caseId,
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        feesCents: whole(row.fees_cents),
        costsCents: whole(row.costs_cents),
        marginCents: whole(row.margin_cents),
      },
    ];
  });
}

export type ProjectedMonth = {
  /** "YYYY-MM": the month a judgment is expected in; the first is this month, holding what is already past due. */
  month: string;
  judgments: number;
  /** The judgments expected won in whole or in part, by each court's own rate: a figure with one decimal. */
  wins: number;
};

export type Projection = {
  months: ProjectedMonth[];
  /** Lawsuits waiting for judgment that the firm's history cannot project (fewer than the sample in their court). */
  unprojected: number;
};

const addDays = (day: string, count: number): string =>
  new Date(Date.parse(`${day}T12:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

/**
 * The judgments and wins of the months ahead, from the firm's own history: each lawsuit still waiting for its
 * judgment (none, no settlement, its case not ended) expects it the median days after its filing its court took, and
 * wins it by the rate its court gave; a court with fewer than the sample judged projects nothing of its lawsuits,
 * which are counted apart. A judgment already past its expected day is counted in this month. An estimate of the
 * firm's own numbers, never a promise of a result.
 */
export function winsProjection(
  rows: readonly LawsuitRow[],
  checkedOnly: boolean,
  today: string,
  monthsAhead = 6,
): Projection {
  const byCourt = new Map<string, LawsuitRow[]>();
  for (const row of rows) byCourt.set(row.court, [...(byCourt.get(row.court) ?? []), row]);
  const courtStats = new Map([...byCourt.entries()].map(([court, list]) => [court, statsOf(court, list, checkedOnly)]));
  const first = today.slice(0, 7);
  const months: ProjectedMonth[] = Array.from({ length: monthsAhead }, (_, index) => {
    const date = new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1 + index, 1));
    return { month: date.toISOString().slice(0, 7), judgments: 0, wins: 0 };
  });
  let unprojected = 0;
  for (const row of rows) {
    if (judgment(row, checkedOnly) !== null || row.result !== null || row.settled || row.closed) continue;
    const stats = courtStats.get(row.court);
    if (!stats || stats.daysToJudgment === null || stats.successRate === null) {
      unprojected += 1;
      continue;
    }
    const expected = addDays(row.filedOn, stats.daysToJudgment).slice(0, 7);
    const slot = months.find((month) => month.month === (expected < first ? first : expected));
    if (!slot) continue;
    slot.judgments += 1;
    slot.wins += stats.successRate;
  }
  return {
    months: months.map((month) => ({ ...month, wins: Math.round(month.wins * 10) / 10 })),
    unprojected,
  };
}
