import assert from "node:assert/strict";
import { test } from "node:test";

import { brasiliaDay, isStagnant, STAGNANT_DAYS, STOCK_RULE_VERSION, STOCK_STEPS, stepDays } from "./stock.ts";

test("the rule says its version", () => {
  assert.equal(STOCK_RULE_VERSION, "estoque-v1");
});

test("a moment falls on a day of Brasília", () => {
  const cases: [string | null, string | null][] = [
    ["2026-11-08T02:59:00Z", "2026-11-07"],
    ["2026-11-08T03:00:00Z", "2026-11-08"],
    ["2026-11-08T12:00:00-03:00", "2026-11-08"],
    [null, null],
    ["ontem", null],
  ];
  for (const [moment, day] of cases) assert.equal(brasiliaDay(moment), day, String(moment));
});

test("the days at a step are counted in the days of Brasília", () => {
  const cases: [string | null, string, number | null][] = [
    ["2026-11-08T12:00:00-03:00", "2026-11-08", 0],
    ["2026-11-07T23:59:00-03:00", "2026-11-08", 1],
    ["2026-11-08T01:00:00Z", "2026-11-08", 1],
    ["2026-10-09T10:00:00-03:00", "2026-11-08", 30],
    ["2026-11-09T10:00:00-03:00", "2026-11-08", 0],
    [null, "2026-11-08", null],
    ["2026-11-08T12:00:00-03:00", "2026-02-30", null],
  ];
  for (const [since, today, days] of cases) assert.equal(stepDays(since, today), days, `${since} → ${today}`);
});

test("a case stagnates past the limit of its step, never at it", () => {
  const cases: [string | null, number | null, boolean][] = [
    ["documents", 15, false],
    ["documents", 16, true],
    ["intake", 8, true],
    ["hearing", 120, false],
    ["hearing", 121, true],
    ["closed", 4000, false],
    [null, 400, false],
    ["documents", null, false],
  ];
  for (const [step, days, stagnant] of cases) assert.equal(isStagnant(step, days), stagnant, `${step} ${days}`);
});

test("the limits are the setting's when it says them", () => {
  assert.equal(isStagnant("documents", 10, { documents: 5 }), true);
  assert.equal(isStagnant("documents", 10, {}), false);
  assert.deepEqual(Object.keys(STAGNANT_DAYS), [...STOCK_STEPS]);
});
