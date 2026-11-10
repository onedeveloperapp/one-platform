import { budgetStanding, readForecast, readReport } from "./reports";
import { describe, expect, it } from "vitest";

describe("the budget of a month", () => {
  it("marks an expense over its plan and an income under it, never the other way", () => {
    const row = { categoryId: "a", category: "Aluguel", kind: "expense", planned: 300_000, actual: 320_000 };
    expect(budgetStanding(row)).toEqual({ difference: 20_000, share: 107, attention: true });
    expect(budgetStanding({ ...row, actual: 280_000 }).attention).toBe(false);
    expect(budgetStanding({ ...row, kind: "income", actual: 280_000 }).attention).toBe(true);
    expect(budgetStanding({ ...row, kind: "income", actual: 320_000 }).attention).toBe(false);
  });
});

describe("readReport", () => {
  it("reads the budget, the cost centres, the partners and what changed after the closing", () => {
    const report = readReport({
      month: "2026-10-01",
      current: {
        dre: [],
        dfc: [],
        centers: [{ center: null, income: 100, expense: 50 }],
        partners: [{ partner: "Ana Lima", category: "Pró-labore", cents: -500_000 }],
      },
      previous: {},
      last_year: {},
      closing: { closed_at: "2026-11-25T12:00:00Z", by_one: true, reopened_at: null, changed_after: 2 },
      check: { green: true },
      budget: {
        rows: [{ category_id: "c1", category: "Aluguel", kind: "expense", planned: 300_000, actual: 320_000 }],
        outside_income: 0,
        outside_expense: 12_900,
      },
    });
    expect(report?.current.centers).toEqual([{ center: null, income: 100, expense: 50 }]);
    expect(report?.current.partners[0]).toEqual({ partner: "Ana Lima", category: "Pró-labore", cents: -500_000 });
    expect(report?.closing?.changedAfter).toBe(2);
    expect(report?.budget.rows[0]).toMatchObject({ categoryId: "c1", planned: 300_000, actual: 320_000 });
    expect(report?.budget.outsideExpense).toBe(12_900);
    // A report of before 0163 has none of them, and reads as empty.
    expect(readReport({ month: "2026-10-01", current: {}, previous: {}, last_year: {} })?.budget).toEqual({
      rows: [],
      outsideIncome: 0,
      outsideExpense: 0,
    });
  });
});

describe("readForecast", () => {
  it("keeps the expected success fees apart from the weeks", () => {
    const forecast = readForecast({
      balance: 1_000,
      weeks: [{ starts_on: "2026-11-09", in_cents: 500, out_cents: 200 }],
      expected: { cents: 300_000, final_cents: 0, lawsuits: 1, cases: 1 },
    });
    expect(forecast?.weeks[0]?.balance).toBe(1_300);
    expect(forecast?.expected).toEqual({ cents: 300_000, finalCents: 0, lawsuits: 1, cases: 1 });
  });
});
