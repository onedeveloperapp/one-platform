/**
 * Where a trip an agency registered stands along its way, for the view of its progress in the agency's area (the
 * owner, 2026-11-03): the passenger's agreement, the flights ONE follows, a problem told to the passenger, and the
 * passenger with the firm; each done, under way or still to come, and in a sentence what happens now and who it
 * is with. Pure: read from the trip's state (0070, 0071) and the passenger's answers. The agency reads nothing of
 * the firm's case past the hand-over.
 */

import { type ConsentAnswer, type PaxRow, type Reagree, type TripState } from "./passengers";

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

export function passengerReached(input: {
  consent: ConsentAnswer | null;
  /** Their way ended with the firm: a trip of theirs became a case and none is ahead of them (0106). */
  handedOver: boolean;
  /** The yes no longer covers their trips (their WhatsApp changed, or a trip waits, 0086): back at the agreement. */
  reagree?: boolean;
}): {
  reached: number;
  state: "progress" | "done" | "stopped";
} {
  // A next trip waiting for the yes is the agency's again, also after a case (0106).
  if (input.consent === "agreed" && input.reagree) return { reached: 0, state: "progress" };
  if (input.handedOver) return { reached: 2, state: "done" };
  if (input.consent === "agreed") return { reached: 1, state: "progress" };
  if (input.consent === "declined" || input.consent === "withdrawn") return { reached: 0, state: "stopped" };
  return { reached: 0, state: "progress" };
}

/**
 * Where a passenger of the list stands, read the same on the list and on the home. "Com o escritório" is of the
 * trip that became a case, never of the person (the owner, 2026-11-05): a passenger whose trip went to the firm and
 * who has another trip ahead goes on along the way from it (an agreement owed again, or ONE following it), with the
 * case said beside it; only one with nothing ahead is at the firm's step.
 */
export function passengerStanding(row: Pick<PaxRow, "consent" | "reagree" | "handedOver" | "nextDeparture">): {
  reached: number;
  state: "progress" | "done" | "stopped";
  /** A yes that no longer covers their trips (their WhatsApp changed, or a trip waits, 0086): owed again. */
  reagree: boolean;
  /** Their way ended with the firm: nothing of theirs is ahead. */
  withFirm: boolean;
  /** A trip of theirs is a case at the firm while their way goes on. */
  hadCase: boolean;
} {
  const reagree = row.consent === "agreed" && row.reagree !== null;
  // The list's next departure is never of the trip that became a case (0106).
  const withFirm = row.handedOver && !reagree && row.nextDeparture === null;
  return {
    ...passengerReached({ consent: row.consent, handedOver: withFirm, reagree }),
    reagree,
    withFirm,
    hadCase: row.handedOver && !withFirm,
  };
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

/** What happens now to a trip whose holder's yes no longer covers it (0086), by why. */
export const REAGREE_NOW_KEY: Record<Reagree, string> = {
  phone_changed: "pax-journey-now-reagree-phone",
  trip_waiting: "pax-journey-now-reagree-trip",
};

export const TRIP_HOLDER_KEY: Record<TripJourney["holder"], string> = {
  passenger: "pax-journey-holder-passenger",
  one: "pax-journey-holder-one",
  firm: "pax-journey-holder-firm",
  ended: "pax-journey-holder-ended",
};
