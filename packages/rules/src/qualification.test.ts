import assert from "node:assert/strict";
import { test } from "node:test";

import {
  problemOfAlert,
  problemOfIncident,
  qualify,
  QUALIFICATION_RULE,
  type QualificationInput,
} from "./qualification.ts";

const TODAY = "2026-11-10";
const base = (overrides: Partial<QualificationInput>): QualificationInput => ({
  problem: "cancellation",
  flightDay: "2026-11-02",
  today: TODAY,
  international: false,
  ...overrides,
});

// Every line of the plan's table (the owner, 2026-11-07 and 2026-11-10), as the rule answers it.
const TABLE: {
  name: string;
  input: Partial<QualificationInput>;
  outcome: string;
  reasons: string[];
  assumptions?: string[];
  missing?: string[];
}[] = [
  { name: "a cancellation told late", input: { notice: "late" }, outcome: "qualifies", reasons: ["cancelled"] },
  {
    name: "a cancellation told at the airport",
    input: { notice: "at_airport" },
    outcome: "qualifies",
    reasons: ["cancelled"],
  },
  {
    name: "a cancellation whose notice is not known yet",
    input: { notice: null },
    outcome: "qualifies",
    reasons: ["cancelled"],
    assumptions: ["notice_unknown"],
  },
  {
    name: "a cancellation told 72 hours or more before, with no exception",
    input: { notice: "early" },
    outcome: "not_qualified",
    reasons: ["cancelled_early_notice"],
  },
  {
    name: "a cancellation told early, with no alternatives offered",
    input: { notice: "early", exceptions: ["no_alternatives"] },
    outcome: "qualifies",
    reasons: ["cancelled_with_exception"],
  },
  {
    name: "a domestic change told late, 31 minutes",
    input: { problem: "change", notice: "late", changeMinutes: 31 },
    outcome: "qualifies",
    reasons: ["changed"],
  },
  {
    name: "a domestic change told late, 30 minutes",
    input: { problem: "change", notice: "late", changeMinutes: 30 },
    outcome: "not_qualified",
    reasons: ["changed_small"],
  },
  {
    name: "an international change told late, 50 minutes",
    input: { problem: "change", notice: "late", changeMinutes: 50, international: true },
    outcome: "not_qualified",
    reasons: ["changed_small"],
  },
  {
    name: "an international change told late, 61 minutes earlier",
    input: { problem: "change", notice: "late", changeMinutes: -61, international: true },
    outcome: "qualifies",
    reasons: ["changed"],
  },
  {
    name: "a small change told late, with a loss proven, is still small",
    input: { problem: "change", notice: "late", changeMinutes: 20, exceptions: ["proven_loss"] },
    outcome: "not_qualified",
    reasons: ["changed_small"],
  },
  {
    name: "a change told 72 hours or more before, with no exception",
    input: { problem: "change", notice: "early", changeMinutes: 180 },
    outcome: "not_qualified",
    reasons: ["changed_early_notice"],
  },
  {
    name: "a change told early, with a credit imposed",
    input: { problem: "change", notice: "early", changeMinutes: 180, exceptions: ["credit_imposed"] },
    outcome: "qualifies",
    reasons: ["changed_with_exception"],
  },
  {
    name: "a change of unknown size",
    input: { problem: "change", notice: "late", changeMinutes: null },
    outcome: "pending",
    reasons: ["changed"],
    missing: ["change"],
  },
  {
    name: "a change of a flight not known to be domestic is held to the domestic limit",
    input: { problem: "change", notice: null, changeMinutes: 45, international: null },
    outcome: "qualifies",
    reasons: ["changed"],
    assumptions: ["international_unknown", "notice_unknown"],
  },
  {
    name: "a delay of 4 hours at the arrival",
    input: { problem: "delay", arrivalDelayMinutes: 240 },
    outcome: "qualifies",
    reasons: ["delayed"],
  },
  {
    name: "a delay of 3 hours and 59 minutes",
    input: { problem: "delay", arrivalDelayMinutes: 239 },
    outcome: "not_qualified",
    reasons: ["delay_short"],
  },
  {
    name: "a lost connection that arrived 5 hours late",
    input: { problem: "missed_connection", arrivalDelayMinutes: 300 },
    outcome: "qualifies",
    reasons: ["delayed"],
  },
  {
    name: "a delay whose arrival is not known",
    input: { problem: "delay", arrivalDelayMinutes: null },
    outcome: "pending",
    reasons: ["delayed"],
    missing: ["arrival"],
  },
  { name: "boarding denied", input: { problem: "overbooking" }, outcome: "qualifies", reasons: ["overbooking"] },
  { name: "a bag lost", input: { problem: "baggage_lost" }, outcome: "qualifies", reasons: ["baggage"] },
  { name: "a bag damaged", input: { problem: "baggage_damaged" }, outcome: "qualifies", reasons: ["baggage"] },
  { name: "a bag delivered late", input: { problem: "baggage_delayed" }, outcome: "qualifies", reasons: ["baggage"] },
  {
    name: "a downgrade is a person's to weigh",
    input: { problem: "downgrade" },
    outcome: "review",
    reasons: ["outside_rule"],
  },
  {
    name: "another problem is a person's to weigh",
    input: { problem: "other" },
    outcome: "review",
    reasons: ["outside_rule"],
  },
];

for (const row of TABLE) {
  test(`qualification: ${row.name}`, () => {
    const result = qualify(base(row.input));
    assert.equal(result.rule, QUALIFICATION_RULE);
    assert.equal(result.outcome, row.outcome);
    assert.deepEqual(result.reasons, row.reasons);
    assert.deepEqual(result.assumptions, row.assumptions ?? []);
    assert.deepEqual(result.missing, row.missing ?? []);
  });
}

test("prescription: 5 years for a domestic flight, the last day included", () => {
  assert.equal(qualify(base({ flightDay: "2021-11-10", notice: "late" })).outcome, "qualifies");
  const out = qualify(base({ flightDay: "2021-11-09", notice: "late" }));
  assert.equal(out.outcome, "not_qualified");
  assert.deepEqual(out.reasons, ["prescribed"]);
  assert.deepEqual(out.claims, { material: false, moral: false });
});

test("prescription: an international flight loses the material damage after 2 years and keeps the moral one to 5", () => {
  const three = qualify(base({ flightDay: "2023-10-01", notice: "late", international: true }));
  assert.equal(three.outcome, "qualifies");
  assert.deepEqual(three.reasons, ["cancelled", "material_prescribed"]);
  assert.deepEqual(three.claims, { material: false, moral: true });
  const one = qualify(base({ flightDay: "2025-10-01", notice: "late", international: true }));
  assert.deepEqual(one.claims, { material: true, moral: true });
  // A flight not known to be international keeps the material claim, and says what it assumed.
  const unknown = qualify(base({ flightDay: "2023-10-01", notice: "late", international: null }));
  assert.deepEqual(unknown.claims, { material: true, moral: true });
  assert.deepEqual(unknown.assumptions, ["international_unknown"]);
  // Out of the 5 years, an international flight is prescribed too.
  assert.equal(qualify(base({ flightDay: "2021-01-01", international: true })).outcome, "not_qualified");
});

test("a 29 February flight is in time on 28 February five years on, and not the day after", () => {
  assert.equal(qualify(base({ flightDay: "2024-02-29", today: "2029-02-28", notice: "late" })).outcome, "qualifies");
  assert.equal(
    qualify(base({ flightDay: "2024-02-29", today: "2029-03-01", notice: "late" })).outcome,
    "not_qualified",
  );
});

test("a flight with no day, or a day that is no day, waits for it", () => {
  assert.deepEqual(qualify(base({ flightDay: null })).missing, ["flight_day"]);
  assert.equal(qualify(base({ flightDay: "2026-02-30" })).outcome, "pending");
});

test("a case's incident and ONE's alert are the rule's problems", () => {
  assert.equal(problemOfIncident("delay"), "delay");
  assert.equal(problemOfIncident("overbooking"), "overbooking");
  assert.equal(problemOfIncident("whatever"), "other");
  assert.equal(problemOfAlert("cancelled"), "cancellation");
  assert.equal(problemOfAlert("changed"), "change");
  assert.equal(problemOfAlert("delayed"), "delay");
});
