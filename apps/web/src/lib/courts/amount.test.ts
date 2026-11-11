// @vitest-environment node
import { describe, expect, it } from "vitest";

import { amountDue, amountStepKey, lawsuitAmountsOf, monthsNeeded, paymentTermEnds } from "@/lib/courts/amount";

// Every value here is invented.

const rates = {
  ipca: { "2025-10": 0.5, "2025-11": 0.4, "2025-12": 0.5 },
  selic: { "2025-10": 1.2, "2025-11": 1.0, "2025-12": 1.1 },
};
const facts = {
  principalCents: 500_000,
  judgmentOn: "2025-09-20",
  interestFrom: "2025-09-20",
  finalOn: "2025-11-03",
  depositedCents: 0,
  lastDepositOn: null,
  kind: "juizado" as const,
  payUntil: "2025-11-25",
};

describe("what a condemnation is worth and what to ask for it (0184, 0214)", () => {
  it("counts the airline's 15 business days from the final judgment over the court's calendar", () => {
    const place = { proceedingKind: "juizado", system: "projudi", comarca: "Goiânia" };
    // From Monday 03/11/2025: 20/11 (Consciência Negra) is no business day, so the 15th is Tuesday 25/11.
    expect(paymentTermEnds("2025-11-03", place, { years: [], days: [] })).toBe("2025-11-25");
    // A day the court had no business moves it one more.
    const closed = {
      day: "2025-11-14",
      kind: "closed" as const,
      label: "Ponto facultativo",
      proceedingKinds: [],
      systems: [],
      comarcas: [],
    };
    expect(paymentTermEnds("2025-11-03", place, { years: [], days: [closed] })).toBe("2025-11-26");
  });

  it("in the small-claims court waits while the airline's term runs, then asks the cumprimento with its fine", () => {
    expect(amountDue(facts, rates, "2025-11-25").step).toBe("aguardar");
    expect(amountDue(facts, rates, "2025-11-25").payUntil).toBe("2025-11-25");
    const late = amountDue(facts, rates, "2025-11-26");
    expect(late.step).toBe("cumprimento");
    expect(late.fineCents).toBe(Math.round(late.totalCents * 0.1));
    expect(amountStepKey(late.step, "juizado")).toBe("amount-step-enforce");
  });

  it("in the civil court asks the cumprimento at once, with no fine before the intimation's term", () => {
    const civil = amountDue({ ...facts, kind: "comum", payUntil: null }, rates, "2025-11-04");
    expect(civil.step).toBe("cumprimento");
    expect(civil.fineCents).toBe(0);
    expect(civil.payUntil).toBeNull();
    expect(amountStepKey(civil.step, "comum")).toBe("amount-step-request");
  });

  it("waits three weeks when the court's calendar could not count the term", () => {
    const uncounted = { ...facts, payUntil: null };
    expect(amountDue(uncounted, rates, "2025-11-24").step).toBe("aguardar");
    expect(amountDue(uncounted, rates, "2025-11-25").step).toBe("cumprimento");
  });

  it("asks the levantamento of a whole deposit and the complementação of a short one", () => {
    const due = amountDue(facts, rates, "2025-12-10").totalCents;
    expect(amountDue({ ...facts, depositedCents: due }, rates, "2025-12-10").step).toBe("levantamento");
    const short = amountDue({ ...facts, depositedCents: due - 10_000 }, rates, "2025-12-10");
    expect(short.step).toBe("complementacao");
    expect(short.shortCents).toBe(10_000);
  });

  it("says a judgment before Lei 14.905/2024 needs its own terms, and reads only the months after it", () => {
    const old = amountDue({ ...facts, judgmentOn: "2024-05-10", interestFrom: "2024-05-10" }, rates, "2025-12-10");
    expect(old.needsTerms).toBe(true);
    expect(old.missing.every((month) => month >= "2024-08")).toBe(true);
    expect(monthsNeeded({ ...facts, judgmentOn: "2024-05-10" }, "2025-12-10")).toEqual({
      from: "2024-08",
      to: "2025-12",
    });
  });

  it("reads what the case screen shows, and nothing that is not an amount", () => {
    expect(
      lawsuitAmountsOf([
        {
          proceeding_id: "p1",
          next_step: "levantamento",
          total_cents: 100,
          missing: ["2025-12"],
          lawsuit_kind: "juizado",
          pay_until: "2025-11-25",
        },
        { proceeding_id: "p2", next_step: "nonsense" },
      ]),
    ).toMatchObject([
      {
        proceedingId: "p1",
        step: "levantamento",
        totalCents: 100,
        missing: ["2025-12"],
        kind: "juizado",
        payUntil: "2025-11-25",
      },
    ]);
  });
});
