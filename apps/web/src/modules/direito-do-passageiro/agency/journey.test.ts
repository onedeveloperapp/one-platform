import { passengerReached, passengerStanding, tripJourney } from "./journey";
import { describe, expect, it } from "vitest";

const states = (journey: ReturnType<typeof tripJourney>) => journey.steps.map((step) => `${step.step}:${step.state}`);

describe("tripJourney", () => {
  it("waits for the passenger's agreement first", () => {
    const journey = tripJourney({ state: "waiting_consent", everAgreed: false });
    expect(states(journey)).toEqual(["agreement:current", "watching:next", "alerted:next", "firm:next"]);
    expect(journey.holder).toBe("passenger");
  });

  it("is with ONE while it follows the flights, and with the passenger once told of a problem", () => {
    expect(states(tripJourney({ state: "watching", everAgreed: true }))).toEqual([
      "agreement:done",
      "watching:current",
      "alerted:next",
      "firm:next",
    ]);
    const alerted = tripJourney({ state: "alerted", everAgreed: true });
    expect(alerted.steps[2].state).toBe("current");
    expect(alerted.holder).toBe("passenger");
  });

  it("arrives with the firm, or stops short when the passenger did not go on", () => {
    const opened = tripJourney({ state: "case_opened", everAgreed: true });
    expect(opened.steps.every((step) => step.state === "done")).toBe(true);
    expect(opened.ended).toBe("firm");
    const declined = tripJourney({ state: "declined", everAgreed: true });
    expect(states(declined).at(-1)).toBe("firm:stopped");
    expect(declined.holder).toBe("ended");
  });

  it("stops at the flights once agreed, else at the agreement", () => {
    expect(states(tripJourney({ state: "stopped", everAgreed: true }))[1]).toBe("watching:stopped");
    expect(states(tripJourney({ state: "stopped", everAgreed: false }))[0]).toBe("agreement:stopped");
  });
});

describe("passengerReached", () => {
  it("reads a row of the list", () => {
    expect(passengerReached({ consent: null, handedOver: false })).toEqual({ reached: 0, state: "progress" });
    expect(passengerReached({ consent: "withdrawn", handedOver: false })).toEqual({ reached: 0, state: "stopped" });
    expect(passengerReached({ consent: "agreed", handedOver: false })).toEqual({ reached: 1, state: "progress" });
    // A yes that no longer covers the trips (another WhatsApp, a trip waiting) is back at the agreement.
    expect(passengerReached({ consent: "agreed", handedOver: false, reagree: true })).toEqual({
      reached: 0,
      state: "progress",
    });
    expect(passengerReached({ consent: "agreed", handedOver: true })).toEqual({ reached: 2, state: "done" });
    // A next trip of a passenger with the firm waits for their yes again (0106).
    expect(passengerReached({ consent: "agreed", handedOver: true, reagree: true })).toEqual({
      reached: 0,
      state: "progress",
    });
  });
});

describe("passengerStanding", () => {
  const row = { consent: "agreed" as const, reagree: null, handedOver: false, nextDeparture: null };

  it("reads a passenger who never went to the firm as before", () => {
    expect(passengerStanding(row)).toEqual({
      reached: 1,
      state: "progress",
      reagree: false,
      withFirm: false,
      hadCase: false,
    });
    expect(passengerStanding({ ...row, reagree: "trip_waiting" })).toMatchObject({ reached: 0, reagree: true });
  });

  it("is at the firm only while nothing of theirs is ahead", () => {
    expect(passengerStanding({ ...row, handedOver: true })).toEqual({
      reached: 2,
      state: "done",
      reagree: false,
      withFirm: true,
      hadCase: false,
    });
  });

  it("goes on from a next trip, with the case said beside it", () => {
    // ONE follows the next trip: their yes covers it.
    expect(passengerStanding({ ...row, handedOver: true, nextDeparture: "2099-03-10T08:10" })).toEqual({
      reached: 1,
      state: "progress",
      reagree: false,
      withFirm: false,
      hadCase: true,
    });
    // The next trip waits for their yes.
    expect(
      passengerStanding({ ...row, handedOver: true, reagree: "trip_waiting", nextDeparture: "2099-03-10T08:10" }),
    ).toEqual({ reached: 0, state: "progress", reagree: true, withFirm: false, hadCase: true });
  });
});
