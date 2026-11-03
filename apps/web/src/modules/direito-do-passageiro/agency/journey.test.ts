import { passengerReached, tripJourney } from "./journey";
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
  });
});
