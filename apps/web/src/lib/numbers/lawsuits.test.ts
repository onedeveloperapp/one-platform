import {
  claimStats,
  cohorts,
  groupStats,
  median,
  readLawsuitRows,
  statsOf,
  winsProjection,
  withinPeriod,
} from "./lawsuits";
import { describe, expect, it } from "vitest";

// Every lawsuit here is invented.
const row = (id: string, fields: Record<string, unknown>) => ({
  id,
  case_id: `c-${id}`,
  case_seq: 1,
  cnj: "",
  airline: "LA",
  incident: "delay",
  court: "TJGO",
  comarca: "Goiânia",
  kind: "juizado",
  filed_on: "2026-03-01",
  opened_on: "2026-02-20",
  result: null,
  judged_on: null,
  judged_checked: true,
  value_cents: null,
  settled: false,
  final: false,
  paid_on: null,
  closed: false,
  unchecked: 0,
  is_test: false,
  ...fields,
});

const rows = readLawsuitRows({
  rows: [
    row("1", { result: "procedente", judged_on: "2026-06-01", value_cents: 500000 }),
    row("2", { result: "procedente", judged_on: "2026-06-11", value_cents: 300000 }),
    row("3", { result: "parcial", judged_on: "2026-07-01", value_cents: 200000 }),
    row("4", { result: "improcedente", judged_on: "2026-07-11", judged_checked: false, unchecked: 1 }),
    row("5", { result: "procedente", judged_on: "2026-05-01", value_cents: 400000, airline: "G3" }),
    row("6", {
      result: "procedente",
      judged_on: "2026-08-01",
      value_cents: 600000,
      filed_on: "2026-04-01",
      paid_on: "2026-09-01",
      final: true,
    }),
  ],
});

describe("the firm's numbers", () => {
  it("never averages fewer than five", () => {
    expect(median([1, 2, 3, 4])).toBeNull();
    expect(median([5, 1, 3, 2, 4])).toBe(3);
  });

  it("counts a number from its own list, with its sample", () => {
    const all = statsOf("", rows, false);
    expect(all.lawsuits).toBe(6);
    expect(all.judged).toBe(6);
    expect(all.successRate).toBeCloseTo(5 / 6);
    expect(all.valuePerClaimant).toBe(400000);
    expect(all.unchecked).toBe(1);
    expect(all.ids).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("leaves out what nobody checked when asked, and the rate with it below the sample", () => {
    const checked = statsOf("", rows, true);
    expect(checked.judged).toBe(5);
    expect(checked.successRate).toBe(1);
  });

  it("groups by a dimension, the largest group first, each with its lawsuits", () => {
    const groups = groupStats(rows, "airline", false);
    expect(groups.map((group) => [group.key, group.lawsuits])).toEqual([
      ["LA", 5],
      ["G3", 1],
    ]);
    expect(groups[1]!.successRate).toBeNull();
  });

  it("reads the cohorts by the month of the filing", () => {
    const list = cohorts(rows, false);
    expect(list.map((cohort) => [cohort.month, cohort.filed, cohort.paid, cohort.lost])).toEqual([
      ["2026-04", 1, 1, 0],
      ["2026-03", 5, 0, 1],
    ]);
    expect(withinPeriod(rows, "2026-04-01", null).map((item) => item.id)).toEqual(["6"]);
  });
});

describe("the unit and the projection of judgments (0168)", () => {
  // Five lawsuits of TJGO judged 92 days after filing, four won: a rate of 80 percent.
  const judged = [1, 2, 3, 4, 5].map((n) =>
    row(`j${n}`, {
      filed_on: "2026-01-01",
      result: n === 5 ? "improcedente" : "procedente",
      judged_on: "2026-04-03",
      unit: "1º Juizado Especial Cível",
    }),
  );
  const waiting = [
    row("w1", { filed_on: "2026-09-15" }),
    row("w2", { filed_on: "2026-07-01" }),
    row("w3", { filed_on: "2026-10-01", court: "TJSP" }),
    row("w4", { filed_on: "2026-09-20", settled: true }),
  ];
  const lawsuits = readLawsuitRows({ rows: [...judged, ...waiting] });

  it("groups by the unit the court records", () => {
    const groups = groupStats(lawsuits, "unit", false);
    expect(groups.map((group) => [group.key, group.lawsuits])).toEqual([
      ["1º Juizado Especial Cível", 5],
      ["", 4],
    ]);
  });

  it("expects each waiting judgment the court's median days after its filing, won by the court's rate", () => {
    const projection = winsProjection(lawsuits, false, "2026-11-10", 3);
    // w2 was due in October and counts in this month; w1 is due in December.
    expect(projection.months).toEqual([
      { month: "2026-11", judgments: 1, wins: 0.8 },
      { month: "2026-12", judgments: 1, wins: 0.8 },
      { month: "2027-01", judgments: 0, wins: 0 },
    ]);
    // TJSP has no judged lawsuit of the firm to project from; a settled lawsuit waits for nothing.
    expect(projection.unprojected).toBe(1);
  });
});

describe("the result of each claim, over the judgments (0193)", () => {
  const morals = (cents: number, perClaimant = false) => ({
    claim: "danos_morais",
    result: "concedido",
    cents,
    per_claimant: perClaimant,
  });
  const judged = readLawsuitRows({
    rows: [
      row("m1", { result: "procedente", judged_on: "2026-06-01", claims: [morals(500000, true)] }),
      row("m2", { result: "procedente", judged_on: "2026-06-02", claims: [morals(600000)], claimants: 2 }),
      row("m3", {
        result: "parcial",
        judged_on: "2026-06-03",
        claims: [morals(400000, true), { claim: "danos_materiais", result: "negado" }],
      }),
      row("m4", { result: "parcial", judged_on: "2026-06-04", claims: [morals(200000, true)] }),
      row("m5", {
        result: "improcedente",
        judged_on: "2026-06-05",
        claims: [{ claim: "danos_morais", result: "negado" }],
      }),
      row("m6", { result: "procedente", judged_on: "2026-06-06", claims: [morals(800000, true)] }),
      // Not judged: its claims count for nothing.
      row("m7", { claims: [morals(900000, true)] }),
    ],
  });

  it("says how often each claim was granted and its median value per claimant, never of fewer than five", () => {
    const stats = claimStats(judged, false);
    expect(stats.map((item) => item.claim)).toEqual(["danos_morais", "danos_materiais"]);
    const [moral, material] = stats;
    expect([moral.decided, moral.granted, moral.grantRate]).toEqual([6, 5, 5 / 6]);
    // 5.000, 3.000 (6.000 for two claimants), 4.000, 2.000, 8.000: the median is 4.000.
    expect(moral.valuePerClaimant).toBe(400000);
    expect([material.decided, material.granted, material.grantRate, material.valuePerClaimant]).toEqual([
      1,
      0,
      null,
      null,
    ]);
  });

  it("leaves out a judgment nobody checked when asked", () => {
    const unchecked = readLawsuitRows({
      rows: [
        row("u1", { result: "procedente", judged_on: "2026-06-01", judged_checked: false, claims: [morals(100000)] }),
      ],
    });
    expect(claimStats(unchecked, true)).toEqual([]);
    expect(claimStats(unchecked, false)[0].decided).toBe(1);
  });
});
