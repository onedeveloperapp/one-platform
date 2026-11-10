import { feesLine, feeSplitsOf, lateCharge } from "./fees";
import { describe, expect, it } from "vitest";

const say = (key: string, values?: Record<string, string | number>) =>
  values
    ? `${key}(${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join(",")})`
    : key;

describe("lateCharge", () => {
  it("asks nothing on the due day or before it", () => {
    expect(lateCharge(100_000, "2026-11-10", "2026-11-10", 2, 1)).toEqual({
      days: 0,
      fineCents: 0,
      interestCents: 0,
      totalCents: 100_000,
    });
    expect(lateCharge(100_000, "2026-11-20", "2026-11-10", 2, 1).totalCents).toBe(100_000);
  });

  it("charges the fine once and the interest by the days late, thirty days a month", () => {
    // R$ 1.000,00 fifteen days late at 2% and 1% a month: R$ 20,00 of fine and R$ 5,00 of interest.
    expect(lateCharge(100_000, "2026-10-26", "2026-11-10", 2, 1)).toEqual({
      days: 15,
      fineCents: 2_000,
      interestCents: 500,
      totalCents: 102_500,
    });
  });

  it("counts on what is still owed, and nothing when nothing is", () => {
    expect(lateCharge(50_000, "2026-10-11", "2026-11-10", 2, 1)).toMatchObject({
      fineCents: 1_000,
      interestCents: 500,
    });
    expect(lateCharge(0, "2026-10-11", "2026-11-10", 2, 1).totalCents).toBe(0);
  });
});

describe("feesLine", () => {
  const base = {
    entryCents: 0,
    installments: 0,
    installmentCents: 0,
    successPercent: 0,
    successMinCents: 0,
    settlementPercent: null,
  };

  it("says the monthly fee, the fees per act and the late charges of the contract", () => {
    const line = feesLine(
      {
        ...base,
        monthlyCents: 50_000,
        monthlyMonths: 3,
        hearingCents: 30_000,
        appealCents: 40_000,
        lateFinePercent: 2,
        lateInterestPercent: 1,
      },
      say,
    );
    expect(line).toContain("fees-line-monthly(count=3");
    expect(line).toContain("fees-line-hearing(");
    expect(line).toContain("fees-line-appeal(");
    expect(line).toContain("fees-line-late(fine=2%,interest=1%)");
  });

  it("says no fees when the terms hold none", () => {
    expect(feesLine(base, say)).toBe("fees-line-none");
  });
});

describe("feeSplitsOf", () => {
  it("keeps a split with its id and name, ended or not", () => {
    expect(
      feeSplitsOf([
        { id: "a", name: "Carlos Teste", document: "52998224725", bar_registration: "GO 12345", percent: "20" },
        { id: "b", name: "Bia Teste", percent: 10, ended_at: "2026-11-10T12:00:00Z", ended_reason: "Saiu do caso" },
        { id: "", name: "Sem id" },
      ]),
    ).toEqual([
      {
        id: "a",
        name: "Carlos Teste",
        document: "52998224725",
        barRegistration: "GO 12345",
        percent: 20,
        ended: false,
        endedReason: null,
      },
      {
        id: "b",
        name: "Bia Teste",
        document: "",
        barRegistration: "",
        percent: 10,
        ended: true,
        endedReason: "Saiu do caso",
      },
    ]);
  });
});
