import { describe, expect, it } from "vitest";

import {
  billInView,
  billNumbers,
  billOrder,
  billStanding,
  contractSplit,
  type FinanceBill,
  lateChargesOf,
  readFinanceSeries,
  receivableAging,
} from "@/lib/finance/bills";

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
  latePayments: [],
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

  it("ages what clients owe past its day, by band and by who owes the most", () => {
    const owed = (counterparty: string, cents: number, dueOn: string, paidCents = 0): FinanceBill => ({
      ...bill({ direction: "receive", counterparty, cents, dueOn }),
      paidCents,
    });
    const aging = receivableAging(
      [
        owed("Maria Teste", 50000, "2026-11-01"),
        owed("Maria Teste", 30000, "2026-08-01", 10000),
        owed("João Teste", 90000, "2026-03-01"),
        owed("Rui Teste", 20000, "2026-11-20"),
        { ...bill({ direction: "pay", counterparty: "Energia Teste", cents: 18990, dueOn: "2026-10-01" }) },
      ],
      "2026-11-10",
    );
    expect(aging.count).toBe(3);
    expect(aging.cents).toBe(50000 + 20000 + 90000);
    expect(aging.bands.map((band) => [band.band, band.count])).toEqual([
      ["1-30", 1],
      ["31-60", 0],
      ["61-90", 0],
      ["91-180", 1],
      ["180+", 1],
    ]);
    expect(aging.clients[0]).toEqual({ name: "João Teste", count: 1, cents: 90000 });
    expect(aging.clients[1]).toEqual({ name: "Maria Teste", count: 2, cents: 70000 });
  });

  it("reads the firm's series as the database answers them, and leaves out what is not one", () => {
    expect(
      readFinanceSeries([
        {
          id: "s1",
          direction: "pay",
          counterparty: "Imobiliária Teste",
          cents: 250000,
          day: 10,
          status: "active",
          next_due_on: "2026-12-10",
        },
        { id: "s2", direction: "sideways", status: "active" },
        null,
      ]),
    ).toEqual([
      {
        id: "s1",
        direction: "pay",
        counterparty: "Imobiliária Teste",
        category: null,
        cents: 250000,
        day: 10,
        status: "active",
        stoppedReason: null,
        nextDueOn: "2026-12-10",
      },
    ]);
  });

  it("adds the fines and the interest of a bill's payments, and what nobody split (0192)", () => {
    expect(
      lateChargesOf({
        latePayments: [
          {
            id: "p1",
            paidOn: "2026-10-05",
            extraCents: 3000,
            fineCents: 2000,
            interestCents: 1000,
            splitBy: "contract",
          },
          { id: "p2", paidOn: "2026-11-05", extraCents: 900, fineCents: 0, interestCents: 0, splitBy: null },
        ],
      }),
    ).toEqual({ fineCents: 2000, interestCents: 1000, unsplitCents: 900, byContract: true });
    expect(lateChargesOf({ latePayments: [] })).toEqual({
      fineCents: 0,
      interestCents: 0,
      unsplitCents: 0,
      byContract: false,
    });
  });

  it("splits what was paid above a fee by its contract, as the database does (0192)", () => {
    const terms = { finePercent: 2, interestPercent: 1 };
    expect(contractSplit(100000, 3000, terms)).toEqual({ fineCents: 2000, interestCents: 1000 });
    // The fine is at most what was paid above it.
    expect(contractSplit(100000, 1500, terms)).toEqual({ fineCents: 1500, interestCents: 0 });
    // A contract with no interest splits only an extra that is exactly its fine.
    expect(contractSplit(100000, 2000, { finePercent: 2, interestPercent: 0 })).toEqual({
      fineCents: 2000,
      interestCents: 0,
    });
    expect(contractSplit(100000, 2500, { finePercent: 2, interestPercent: 0 })).toBeNull();
    expect(contractSplit(100000, 3000, null)).toBeNull();
    expect(contractSplit(100000, 0, terms)).toBeNull();
  });
});
