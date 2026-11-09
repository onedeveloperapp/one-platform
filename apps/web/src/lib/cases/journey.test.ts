import {
  caseJourney,
  type CourtFacts,
  courtPublicationsOf,
  courtStep,
  NO_COURT_FACTS,
  type StageMoment,
  stageMomentsOf,
  stepOf,
} from "./journey";
import { describe, expect, it } from "vitest";

const CREATED = "2026-11-01T12:00:00Z";
const states = (journey: ReturnType<typeof caseJourney>) => journey.steps.map((step) => `${step.id}:${step.state}`);
const FILED: StageMoment[] = [
  { from: "intake", to: "documents", at: "2026-11-02T10:00:00Z" },
  { from: "documents", to: "drafting", at: "2026-11-04T10:00:00Z" },
  { from: "drafting", to: "ready", at: "2026-11-05T10:00:00Z" },
  { from: "ready", to: "filed", at: "2026-11-06T10:00:00Z" },
];
const court = (facts: Partial<CourtFacts>): CourtFacts => ({ ...NO_COURT_FACTS, ...facts });

describe("caseJourney before the court", () => {
  it("opens at its first step, the rest still to come", () => {
    const journey = caseJourney({ status: "intake", createdAt: CREATED, moments: [], court: NO_COURT_FACTS });
    expect(states(journey)).toEqual([
      "intake:current",
      "documents:next",
      "signature:next",
      "drafting:next",
      "filing:next",
      "hearing:next",
      "judgment:next",
      "payment:next",
      "closed:next",
    ]);
    expect(journey.steps[0].at).toBe(CREATED);
    expect(journey.current).toBe("intake");
    expect(journey.ended).toBeNull();
  });

  it("dates each stage by when the case entered it, and a stage it went past with none", () => {
    const journey = caseJourney({
      status: "drafting",
      createdAt: CREATED,
      moments: FILED.slice(0, 2),
      court: NO_COURT_FACTS,
    });
    expect(states(journey).slice(0, 5)).toEqual([
      "intake:done",
      "documents:done",
      "signature:done",
      "drafting:current",
      "filing:next",
    ]);
    expect(journey.steps.map((step) => step.at).slice(0, 4)).toEqual([
      CREATED,
      "2026-11-02T10:00:00Z",
      null,
      "2026-11-04T10:00:00Z",
    ]);
    expect(journey.reached).toBe(3);
  });

  it("takes a stage gone back to as under way again, and dates nothing ahead of it", () => {
    const moments: StageMoment[] = [
      { from: "intake", to: "drafting", at: "2026-11-02T10:00:00Z" },
      { from: "drafting", to: "documents", at: "2026-11-03T10:00:00Z" },
    ];
    const journey = caseJourney({ status: "documents", createdAt: CREATED, moments, court: NO_COURT_FACTS });
    expect(journey.steps[1]).toMatchObject({ id: "documents", state: "current", at: "2026-11-03T10:00:00Z" });
    expect(journey.steps[3]).toMatchObject({ id: "drafting", state: "next", at: null });
  });

  it("is at the filing while ready, dated when it became ready", () => {
    const journey = caseJourney({
      status: "ready",
      createdAt: CREATED,
      moments: FILED.slice(0, 3),
      court: NO_COURT_FACTS,
    });
    expect(journey.current).toBe("filing");
    expect(journey.steps[4]).toMatchObject({ state: "current", at: "2026-11-05T10:00:00Z" });
  });
});

describe("caseJourney in court", () => {
  it("waits for the hearing, with the one set when there is one, the filing dated when it was filed", () => {
    const journey = caseJourney({
      status: "filed",
      createdAt: CREATED,
      moments: FILED,
      court: court({ nextHearingAt: "2026-12-01T13:00:00Z" }),
    });
    expect(journey.current).toBe("hearing");
    expect(journey.steps[4]).toMatchObject({ id: "filing", state: "done", at: "2026-11-06T10:00:00Z" });
    expect(journey.steps[5]).toMatchObject({ id: "hearing", state: "current", scheduled: "2026-12-01T13:00:00Z" });
  });

  it("waits for the judgment once a hearing was held, for the payment once it was decided", () => {
    const heard = caseJourney({
      status: "filed",
      createdAt: CREATED,
      moments: FILED,
      court: court({ heldAt: "2026-12-01T13:00:00Z" }),
    });
    expect(heard.current).toBe("judgment");
    expect(heard.steps[5]).toMatchObject({ state: "done", at: "2026-12-01T13:00:00Z" });
    const decided = caseJourney({
      status: "filed",
      createdAt: CREATED,
      moments: FILED,
      court: court({ heldAt: "2026-12-01T13:00:00Z", decidedAt: "2027-01-10" }),
    });
    expect(decided.current).toBe("payment");
    expect(decided.steps[6]).toMatchObject({ id: "judgment", state: "done", at: "2027-01-10" });
  });

  it("takes a judgment with no hearing as past the hearing, undated", () => {
    const journey = caseJourney({
      status: "filed",
      createdAt: CREATED,
      moments: FILED,
      court: court({ decidedAt: "2027-01-10" }),
    });
    expect(journey.steps[5]).toMatchObject({ id: "hearing", state: "done", at: null });
  });

  it("is closing once the payment was published, and done at every step once closed", () => {
    const paid = court({ heldAt: "2026-12-01T13:00:00Z", decidedAt: "2027-01-10", paidAt: "2027-03-01" });
    const closing = caseJourney({ status: "filed", createdAt: CREATED, moments: FILED, court: paid });
    expect(closing.current).toBe("closed");
    expect(closing.steps.at(-1)?.state).toBe("current");
    const closed = caseJourney({
      status: "closed",
      createdAt: CREATED,
      moments: [...FILED, { from: "filed", to: "closed", at: "2027-03-10T10:00:00Z" }],
      court: paid,
    });
    expect(closed.steps.every((step) => step.state === "done")).toBe(true);
    expect(closed.steps.at(-1)?.at).toBe("2027-03-10T10:00:00Z");
    expect(closed.steps[7].at).toBe("2027-03-01");
    expect(closed.ended).toBe("closed");
  });
});

describe("caseJourney of a case that did not go on", () => {
  it("stops where it was", () => {
    const moments: StageMoment[] = [
      { from: "intake", to: "documents", at: "2026-11-02T10:00:00Z" },
      { from: "documents", to: "declined", at: "2026-11-05T10:00:00Z" },
    ];
    const journey = caseJourney({ status: "declined", createdAt: CREATED, moments, court: NO_COURT_FACTS });
    expect(states(journey).slice(0, 3)).toEqual(["intake:done", "documents:stopped", "signature:next"]);
    expect(journey.steps[1].at).toBe("2026-11-05T10:00:00Z");
    expect(journey.ended).toBe("declined");
  });

  it("stops in court at the step its lawsuits showed", () => {
    const journey = caseJourney({
      status: "declined",
      createdAt: CREATED,
      moments: [...FILED, { from: "filed", to: "declined", at: "2027-01-20T10:00:00Z" }],
      court: court({ heldAt: "2026-12-01T13:00:00Z" }),
    });
    expect(journey.current).toBe("judgment");
    expect(journey.steps[6].state).toBe("stopped");
  });

  it("stops at the furthest stage when the record does not say where it was", () => {
    const moments: StageMoment[] = [
      { from: null, to: "signature", at: "2026-11-02T10:00:00Z" },
      { from: null, to: "declined", at: "2026-11-05T10:00:00Z" },
    ];
    const journey = caseJourney({ status: "declined", createdAt: CREATED, moments, court: NO_COURT_FACTS });
    expect(journey.steps[2].state).toBe("stopped");
  });
});

describe("the steps of the court", () => {
  it("go from the hearing to closing the case", () => {
    expect(courtStep({ held: false, decided: false, paid: false })).toBe("hearing");
    expect(courtStep({ held: true, decided: false, paid: false })).toBe("judgment");
    expect(courtStep({ held: true, decided: true, paid: false })).toBe("payment");
    expect(courtStep({ held: false, decided: true, paid: true })).toBe("closed");
  });

  it("are read only of a case in court", () => {
    const all = { held: true, decided: true, paid: true };
    expect(stepOf("documents", all)).toBe("documents");
    expect(stepOf("ready", all)).toBe("filing");
    expect(stepOf("declined", all)).toBeNull();
  });
});

describe("stageMomentsOf", () => {
  it("reads the stage changes and leaves out what is not one", () => {
    expect(
      stageMomentsOf([
        { at: "2026-11-02T10:00:00Z", data: { from: "intake", to: "documents" } },
        { at: "2026-11-02T11:00:00Z", data: { to: "nowhere" } },
        { at: null, data: { to: "filed" } },
        { at: "2026-11-02T12:00:00Z", data: { to: "filed" } },
      ]),
    ).toEqual([
      { from: "intake", to: "documents", at: "2026-11-02T10:00:00Z" },
      { from: null, to: "filed", at: "2026-11-02T12:00:00Z" },
    ]);
  });
});

describe("the way read from the case's work (0096)", () => {
  const DRAFTING: StageMoment[] = [
    { from: "intake", to: "documents", at: "2026-11-02T10:00:00Z" },
    { from: "documents", to: "drafting", at: "2026-11-04T10:00:00Z" },
  ];

  it("stays at the signature while a paper sent waits to be signed, whatever stage ONE moved the case to", () => {
    const journey = caseJourney({
      status: "drafting",
      createdAt: CREATED,
      moments: DRAFTING,
      court: NO_COURT_FACTS,
      facts: { signatureSince: "2026-11-04T10:00:05Z", filingSince: null },
    });
    expect(journey.current).toBe("signature");
    expect(states(journey).slice(0, 4)).toEqual([
      "intake:done",
      "documents:done",
      "signature:current",
      "drafting:next",
    ]);
    expect(journey.steps[2].at).toBe("2026-11-04T10:00:05Z");
  });

  it("is at the filing once a package is being built or waits for the lawyer, with the case still in drafting", () => {
    const journey = caseJourney({
      status: "drafting",
      createdAt: CREATED,
      moments: DRAFTING,
      court: NO_COURT_FACTS,
      facts: { signatureSince: null, filingSince: "2026-11-05T09:00:00Z" },
    });
    expect(journey.current).toBe("filing");
    expect(journey.steps[3].state).toBe("done");
    expect(journey.steps[4]).toMatchObject({ state: "current", at: "2026-11-05T09:00:00Z" });
  });

  it("never moves a case in court back by what its preparation left", () => {
    const journey = caseJourney({
      status: "filed",
      createdAt: CREATED,
      moments: FILED,
      court: NO_COURT_FACTS,
      facts: { signatureSince: "2026-11-04T10:00:05Z", filingSince: "2026-11-05T09:00:00Z" },
    });
    expect(journey.current).toBe("hearing");
  });

  it("judges a case only by a decision said to be the judgment", () => {
    expect(
      courtPublicationsOf([
        { category: "decisao", available_on: "2026-11-01", judgment: false },
        { category: "decisao", available_on: "2026-11-03", judgment: null },
        { category: "pagamento", available_on: "2026-11-05" },
      ]),
    ).toEqual({ decidedAt: null, paidAt: "2026-11-05" });
    expect(
      courtPublicationsOf([
        { category: "decisao", available_on: "2026-11-01", judgment: false },
        { category: "decisao", available_on: "2026-11-04", judgment: true },
      ]).decidedAt,
    ).toBe("2026-11-04");
  });
});
