/**
 * Where a trip an agency registered stands along its way, for the view of its progress in the agency's area (the
 * owner, 2026-11-03): the passenger's agreement, the flights ONE follows, a problem told to the passenger, and the
 * passenger with the firm; each done, under way or still to come, and in a sentence what happens now and who it
 * is with. Pure: read from the trip's state (0070, 0071) and the passenger's answers. The agency reads nothing of
 * the firm's case past the hand-over.
 */

import { type ConsentAnswer, type TripState } from "./passengers";

/** The way of a trip, in the order it goes. */
export const TRIP_JOURNEY = ["agreement", "watching", "alerted", "firm"] as const;
export type TripJourneyStep = (typeof TRIP_JOURNEY)[number];

export type TripStepState = "done" | "current" | "next" | "stopped";

export type TripJourney = {
  steps: { step: TripJourneyStep; state: TripStepState }[];
  /** How the way ended, when it did. */
  ended: "firm" | "declined" | "stopped" | null;
  /** Who the trip is with now. */
  holder: "passenger" | "one" | "firm" | "ended";
};

export function tripJourney(input: {
  state: TripState;
  /** The passenger (or who answers for them) agreed at some point: a trip that stopped stopped after it. */
  everAgreed: boolean;
}): TripJourney {
  const at = (reached: number, last: TripStepState): TripJourney["steps"] =>
    TRIP_JOURNEY.map((step, index) => ({
      step,
      state: index < reached ? "done" : index === reached ? last : "next",
    }));
  switch (input.state) {
    case "waiting_consent":
      return { steps: at(0, "current"), ended: null, holder: "passenger" };
    case "watching":
      return { steps: at(1, "current"), ended: null, holder: "one" };
    case "alerted":
      return { steps: at(2, "current"), ended: null, holder: "passenger" };
    case "case_opened":
      return { steps: at(3, "done"), ended: "firm", holder: "firm" };
    case "declined":
      return { steps: at(3, "stopped"), ended: "declined", holder: "ended" };
    case "stopped":
      // The agreement taken back, or the partnership ended: the way stops where ONE was, at the flights once the
      // passenger had agreed, else at the agreement.
      return { steps: at(input.everAgreed ? 1 : 0, "stopped"), ended: "stopped", holder: "ended" };
  }
}

/** The step a passenger of the list is at, from what their row says: the agreement, a trip, the firm. */
export const PASSENGER_JOURNEY = ["agreement", "watching", "firm"] as const;

export function passengerReached(input: { consent: ConsentAnswer | null; handedOver: boolean }): {
  reached: number;
  state: "progress" | "done" | "stopped";
} {
  if (input.handedOver) return { reached: 2, state: "done" };
  if (input.consent === "agreed") return { reached: 1, state: "progress" };
  if (input.consent === "declined" || input.consent === "withdrawn") return { reached: 0, state: "stopped" };
  return { reached: 0, state: "progress" };
}

// The `product` message keys, spelled out so the catalog check sees each one.

export const TRIP_STEP_KEY: Record<TripJourneyStep, string> = {
  agreement: "pax-journey-step-agreement",
  watching: "pax-journey-step-watching",
  alerted: "pax-journey-step-alerted",
  firm: "pax-journey-step-firm",
};

export const TRIP_NOW_KEY: Record<TripState, string> = {
  waiting_consent: "pax-journey-now-waiting-consent",
  watching: "pax-journey-now-watching",
  alerted: "pax-journey-now-alerted",
  case_opened: "pax-journey-now-case-opened",
  declined: "pax-journey-now-declined",
  stopped: "pax-journey-now-stopped",
};

export const TRIP_HOLDER_KEY: Record<TripJourney["holder"], string> = {
  passenger: "pax-journey-holder-passenger",
  one: "pax-journey-holder-one",
  firm: "pax-journey-holder-firm",
  ended: "pax-journey-holder-ended",
};
