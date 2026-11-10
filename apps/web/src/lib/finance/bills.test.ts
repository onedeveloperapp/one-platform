import { describe, expect, it } from "vitest";

import { billInView, billNumbers, billOrder, billStanding, type FinanceBill } from "@/lib/finance/bills";

const bill = (overrides: Partial<FinanceBill>): FinanceBill => ({
  id: "b",
  direction: "pay",
  status: "open",
  counterparty: "Energia Teste",
  description: null,
  categoryId: null,
  category: null,
  caseId: null,
  cents: 10000,
  paidCents: 0,
  dueOn: "2026-11-10",
  competenceOn: "2026-11-01",
  paidOn: null,
  typedLine: null,
  seriesIndex: null,
  seriesTotal: null,
  closedReason: null,
  byOne: false,
  extraCents: 0,
  discountCents: 0,
  ...overrides,
});

describe("the bills to pay and to receive (0129)", () => {
  it("says where a bill stands on a day", () => {
    expect(billStanding(bill({}), "2026-11-12")).toEqual({ kind: "late", days: 2 });
    expect(billStanding(bill({}), "2026-11-10")).toEqual({ kind: "today" });
    expect(billStanding(bill({}), "2026-11-05")).toEqual({ kind: "soon", days: 5 });
    expect(billStanding(bill({}), "2026-10-20")).toEqual({ kind: "open", days: 21 });
    expect(billStanding(bill({ status: "paid", paidOn: "2026-11-09" }), "2026-11-12")).toEqual({
      kind: "paid",
      on: "2026-11-09",
    });
    expect(billStanding(bill({ status: "renegotiated" }), "2026-11-12")).toEqual({
      kind: "closed",
      status: "renegotiated",
    });
  });

  it("puts each bill in its views: a receivable past its day is to charge or inform, never charged by ONE", () => {
    const late = bill({ direction: "receive", dueOn: "2026-11-01" });
    expect(billInView(late, "cobrar", "2026-11-12")).toBe(true);
    expect(billInView(late, "receber", "2026-11-12")).toBe(true);
    expect(billInView(late, "vencidas", "2026-11-12")).toBe(false);
    expect(billInView(bill({ status: "paid" }), "pagas", "2026-11-12")).toBe(true);
    expect(billInView(bill({ status: "cancelled" }), "fechadas", "2026-11-12")).toBe(true);
  });

  it("counts the month's numbers by what is still owed, and what was received", () => {
    const numbers = billNumbers(
      [
        bill({ cents: 10000, paidCents: 4000 }),
        bill({ direction: "receive", cents: 50000, dueOn: "2026-11-20" }),
        bill({ direction: "receive", status: "paid", cents: 30000, paidCents: 30000, paidOn: "2026-11-03" }),
        bill({ dueOn: "2026-12-05" }),
      ],
      "2026-11-12",
    );
    expect(numbers).toEqual({ receiveMonth: 50000, payMonth: 6000, late: 6000, lateCount: 1, receivedMonth: 30000 });
  });

  it("lists the open first by due day, then the closed the latest first", () => {
    const list = [
      bill({ id: "paid", status: "paid", dueOn: "2026-11-01" }),
      bill({ id: "later", dueOn: "2026-11-20" }),
      bill({ id: "sooner", dueOn: "2026-11-05" }),
    ].sort(billOrder);
    expect(list.map((item) => item.id)).toEqual(["sooner", "later", "paid"]);
  });
});
