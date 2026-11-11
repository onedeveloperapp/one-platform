/**
 * The books' reports (migration 0137), as pure rules: the month's income statement in its lines with the result, the
 * cash flow with the clients' money apart, the 13 weeks ahead, and the accountant's package as sheets. Managerial
 * reports, never the firm's accounting: ONE computes no tax, only what was posted appears.
 */

export const DRE_ORDER = ["receita", "deducao", "custo", "despesa", "financeiro"] as const;
export type DreLine = (typeof DRE_ORDER)[number];

export type MonthLines = {
  dre: { line: string; category: string; cents: number }[];
  distribution: number;
  losses: number;
  taxes: boolean;
  dfc: { line: string; cents: number }[];
  /** Income and expense by cost centre, by competence (0163); `center` null for what has none. */
  centers: { center: string | null; income: number; expense: number }[];
  /** The partners' categories by the counterparty written, by cash (0163). */
  partners: { partner: string; category: string; cents: number }[];
};

/** A month's budget against what it came to (0163): positive figures, planned and actual. */
export type Budget = {
  rows: { categoryId: string; category: string; kind: string; planned: number; actual: number }[];
  outsideIncome: number;
  outsideExpense: number;
};

export type Report = {
  month: string;
  current: MonthLines;
  previous: MonthLines;
  lastYear: MonthLines;
  closing: {
    closedAt: string;
    byOne: boolean;
    reopenedAt: string | null;
    reopenReason: string | null;
    /** Entries the bank's statement brought into the month after it closed (0163). */
    changedAfter: number;
  } | null;
  check: { lines: number; accounts: number; apart: number; green: boolean };
  budget: Budget;
};

const whole = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0);
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    : [];

const readLines = (raw: unknown): MonthLines => {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    dre: list(value.dre).map((row) => ({
      line: text(row.line) ?? "despesa",
      category: text(row.category) ?? "",
      cents: whole(row.cents),
    })),
    distribution: whole(value.distribution),
    losses: whole(value.losses),
    taxes: value.taxes === true,
    dfc: list(value.dfc).map((row) => ({ line: text(row.line) ?? "operacional", cents: whole(row.cents) })),
    centers: list(value.centers).map((row) => ({
      center: text(row.center),
      income: whole(row.income),
      expense: whole(row.expense),
    })),
    partners: list(value.partners).map((row) => ({
      partner: text(row.partner) ?? "",
      category: text(row.category) ?? "",
      cents: whole(row.cents),
    })),
  };
};

const readBudget = (raw: unknown): Budget => {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    rows: list(value.rows).flatMap((row) => {
      const categoryId = text(row.category_id);
      return categoryId
        ? [
            {
              categoryId,
              category: text(row.category) ?? "",
              kind: text(row.kind) ?? "expense",
              planned: whole(row.planned),
              actual: whole(row.actual),
            },
          ]
        : [];
    }),
    outsideIncome: whole(value.outside_income),
    outsideExpense: whole(value.outside_expense),
  };
};

/**
 * How a budgeted category stands: under or over what was planned, by how much and by what share of the plan. An
 * expense over its plan, and an income under it, is what to look at.
 */
export function budgetStanding(row: Budget["rows"][number]): { difference: number; share: number; attention: boolean } {
  const difference = row.actual - row.planned;
  const share = row.planned > 0 ? Math.round((row.actual / row.planned) * 100) : 0;
  const attention = row.kind === "income" ? difference < 0 : difference > 0;
  return { difference, share, attention };
}

export function readReport(raw: unknown): Report | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  const closing = (value.closing ?? null) as Record<string, unknown> | null;
  const check = (value.check ?? {}) as Record<string, unknown>;
  return {
    month: text(value.month) ?? "",
    current: readLines(value.current),
    previous: readLines(value.previous),
    lastYear: readLines(value.last_year),
    closing:
      closing && text(closing.closed_at)
        ? {
            closedAt: text(closing.closed_at)!,
            byOne: closing.by_one === true,
            reopenedAt: text(closing.reopened_at),
            reopenReason: text(closing.reopen_reason),
            changedAfter: whole(closing.changed_after),
          }
        : null,
    check: {
      lines: whole(check.lines),
      accounts: whole(check.accounts),
      apart: whole(check.apart),
      green: check.green === true,
    },
    budget: readBudget(value.budget),
  };
}

/** A line's total, and the result: revenue less deductions, costs, expenses and losses, plus the financial result. */
export const lineTotal = (lines: MonthLines, line: DreLine): number =>
  lines.dre.filter((row) => row.line === line).reduce((acc, row) => acc + row.cents, 0);

export function result(lines: MonthLines): number {
  return DRE_ORDER.reduce((acc, line) => acc + lineTotal(lines, line), 0) - lines.losses;
}

/** A cash-flow block's total. */
export const flowTotal = (lines: MonthLines, line: string): number =>
  lines.dfc.filter((row) => row.line === line).reduce((acc, row) => acc + row.cents, 0);

export type Forecast = {
  balance: number;
  weeks: { startsOn: string; inCents: number; outCents: number; balance: number }[];
  /** The success fees expected from judgments won and settlements whose money did not come (0163); never in the weeks. */
  expected: { cents: number; finalCents: number; lawsuits: number; cases: number };
};

/** The 13 weeks ahead, each with the balance it would leave. */
export function readForecast(raw: unknown): Forecast | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  let running = whole(value.balance);
  const expected = (typeof value.expected === "object" && value.expected !== null ? value.expected : {}) as Record<
    string,
    unknown
  >;
  return {
    expected: {
      cents: whole(expected.cents),
      finalCents: whole(expected.final_cents),
      lawsuits: whole(expected.lawsuits),
      cases: whole(expected.cases),
    },
    balance: running,
    weeks: list(value.weeks).map((row) => {
      const inCents = whole(row.in_cents);
      const outCents = whole(row.out_cents);
      running += inCents - outCents;
      return { startsOn: text(row.starts_on) ?? "", inCents, outCents, balance: running };
    }),
  };
}

export type InvoiceData = {
  entryId: string;
  taker: string | null;
  cents: number;
  description: string;
  competence: string;
  caseSeq: number | null;
  invoice: { number: string; issuedOn: string; fileId: string | null } | null;
};

export function readInvoices(raw: unknown): InvoiceData[] | null {
  if (!Array.isArray(raw)) return null;
  return list(raw).flatMap((row) => {
    const entryId = text(row.entry_id);
    if (!entryId) return [];
    const invoice = (row.invoice ?? null) as Record<string, unknown> | null;
    return [
      {
        entryId,
        taker: text(row.taker),
        cents: whole(row.cents),
        description: text(row.description) ?? "",
        competence: text(row.competence) ?? "",
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        invoice:
          invoice && text(invoice.number)
            ? { number: text(invoice.number)!, issuedOn: text(invoice.issued_on) ?? "", fileId: text(invoice.file_id) }
            : null,
      },
    ];
  });
}
