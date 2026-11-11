// @vitest-environment node
import { describe, expect, it } from "vitest";

import { amountDue, lawsuitAmountsOf, monthsNeeded } from "@/lib/courts/amount";

// Every value here is invented.

const rates = {
  ipca: { "2025-10": 0.5, "2025-11": 0.4, "2025-12": 0.5 },
  selic: { "2025-10": 1.2, "2025-11": 1.0, "2025-12": 1.1 },
};
const facts = {
  principalCents: 500_000,
  judgmentOn: "2025-09-20",
  interestFrom: "2025-09-20",
  finalOn: "2025-11-01",
  depositedCents: 0,
  lastDepositOn: null,
};

describe("what a condemnation is worth and what to ask for it (0184)", () => {
  it("waits while the airline's 15 days run, then asks the cumprimento with its fine", () => {
    expect(amountDue(facts, rates, "2025-11-10").step).toBe("aguardar");
    const late = amountDue(facts, rates, "2025-12-10");
    expect(late.step).toBe("cumprimento");
    expect(late.fineCents).toBe(Math.round(late.totalCents * 0.1));
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
        { proceeding_id: "p1", next_step: "levantamento", total_cents: 100, missing: ["2025-12"] },
        { proceeding_id: "p2", next_step: "nonsense" },
      ]),
    ).toMatchObject([{ proceedingId: "p1", step: "levantamento", totalCents: 100, missing: ["2025-12"] }]);
  });
});
