import assert from "node:assert/strict";
import test from "node:test";

import {
  assistanceAsked,
  type InterviewFacts,
  interviewPlan,
  interviewProgress,
  noticeStanding,
  questionsFor,
  skipReason,
  waitMinutes,
} from "./interview.ts";

// Every flight and moment here is invented; the times are local.

const facts = (overrides: Partial<InterviewFacts> = {}): InterviewFacts => ({
  incident: "cancellation",
  alert: null,
  airlineCause: null,
  scheduledDeparture: "2099-10-22T21:30",
  scheduledArrival: "2099-10-23T00:45",
  actualArrival: null,
  companionsKnown: false,
  answers: {},
  ...overrides,
});

test("the questions of each problem, in order; none for a bag and none asked of the purchase", () => {
  assert.deepEqual(questionsFor("cancellation"), [
    "aviso_local",
    "aviso_quando",
    "motivo",
    "solucao",
    "chegada",
    "assistencia",
    "gastos",
    "consequencias",
    "acompanhantes",
    "bagagem",
  ]);
  assert.equal(questionsFor("delay").includes("solucao"), false);
  assert.deepEqual(questionsFor("downgrade"), ["motivo", "gastos", "consequencias", "acompanhantes", "bagagem"]);
  assert.deepEqual(questionsFor("baggage_lost"), []);
  for (const incident of ["delay", "cancellation", "overbooking", "missed_connection", "downgrade", "other"]) {
    assert.equal(
      questionsFor(incident).some((question) => (question as string) === "compra"),
      false,
    );
  }
});

test("a question waits for the one before, and the first one is asked first", () => {
  assert.deepEqual(interviewPlan(facts()), { skips: [], next: "aviso_local" });
  assert.deepEqual(interviewPlan(facts({ answers: { aviso_local: { status: "answered", yesNo: false } } })), {
    skips: [],
    next: "aviso_quando",
  });
});

test("what ONE knows is not asked, and each question left out says why", () => {
  const known = facts({
    airlineCause: "manutenção não programada",
    actualArrival: "2099-10-23T08:10",
    companionsKnown: true,
    answers: { aviso_local: { status: "answered", yesNo: true } },
  });
  assert.equal(skipReason("aviso_quando", known), "at_airport");
  assert.equal(skipReason("motivo", known), "cause_on_record");
  assert.equal(skipReason("chegada", known), "arrival_on_record");
  assert.equal(skipReason("acompanhantes", known), "companions_on_record");
  assert.deepEqual(interviewPlan(known), {
    skips: [
      { question: "aviso_quando", reason: "at_airport" },
      { question: "motivo", reason: "cause_on_record" },
    ],
    next: "solucao",
  });
  // An answer "not known" is an answer: the next question goes.
  assert.equal(interviewPlan(facts({ answers: { aviso_local: { status: "unknown" } } })).next, "aviso_quando");
});

test("the assistance asked is what the wait was owed (Resolution 400, art. 27)", () => {
  assert.equal(waitMinutes(facts({ actualArrival: "2099-10-23T07:45" })), 420);
  assert.deepEqual(assistanceAsked(facts({ actualArrival: "2099-10-23T07:45" })), [
    "alimentacao",
    "hospedagem",
    "transporte",
  ]);
  assert.deepEqual(assistanceAsked(facts({ actualArrival: "2099-10-23T03:15" })), ["alimentacao"]);
  assert.deepEqual(assistanceAsked(facts({ actualArrival: "2099-10-23T01:30" })), []);
  assert.equal(skipReason("assistencia", facts({ actualArrival: "2099-10-23T01:30" })), "short_wait");
  // A wait not known asks of everything; the delay ONE told of is a wait known.
  assert.deepEqual(assistanceAsked(facts()), ["alimentacao", "hospedagem", "transporte"]);
  assert.equal(waitMinutes(facts({ alert: { kind: "delayed", delayMinutes: 360 } })), 360);
  // The arrival the passenger answered counts only with its hour.
  assert.equal(waitMinutes(facts({ answers: { chegada: { status: "answered", moment: "2099-10-23" } } })), null);
  assert.equal(waitMinutes(facts({ answers: { chegada: { status: "answered", moment: "2099-10-23T05:45" } } })), 300);
});

test("when the passenger learned of the change, against the 72 hours of art. 12", () => {
  const told = (moment: string) =>
    facts({
      answers: { aviso_local: { status: "answered", yesNo: false }, aviso_quando: { status: "answered", moment } },
    });
  assert.equal(noticeStanding(facts({ answers: { aviso_local: { status: "answered", yesNo: true } } })), "at_airport");
  assert.equal(noticeStanding(told("2099-10-21T10:00")), "late");
  assert.equal(noticeStanding(told("2099-10-19T21:30")), "early");
  assert.equal(noticeStanding(told("2099-10-19T21:31")), "late");
  // With the day alone: four days or more is early, two or less is late, three days cannot tell.
  assert.equal(noticeStanding(told("2099-10-15")), "early");
  assert.equal(noticeStanding(told("2099-10-20")), "late");
  assert.equal(noticeStanding(told("2099-10-19")), null);
  assert.equal(noticeStanding(facts()), null);
});

test("the place of a question among the ones asked", () => {
  assert.deepEqual(interviewProgress(facts()), { position: 1, total: 10 });
  const along = facts({
    companionsKnown: true,
    answers: {
      aviso_local: { status: "answered", yesNo: true },
      aviso_quando: { status: "skipped" },
      motivo: { status: "unknown" },
    },
  });
  // aviso_quando and acompanhantes are left out: 8 to ask, two of them answered.
  assert.deepEqual(interviewProgress(along), { position: 3, total: 8 });
});
