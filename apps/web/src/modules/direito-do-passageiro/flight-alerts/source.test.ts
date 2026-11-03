import { describe, expect, it } from "vitest";

import { flightNumberOf, followableDay } from "@/lib/test-chat/test-chat";
import {
  followedLegsOf,
  legReadingOf,
  localDay,
  localOf,
  shiftLocal,
} from "@/modules/direito-do-passageiro/flight-alerts/source";
import type { FlightStatus } from "@flyee/flights/types";

// Every flight here is invented.

const LEG = {
  position: 1,
  flightNumber: "LA3300",
  origin: "GRU",
  destination: "BSB",
  departure: "2099-10-22T08:00",
  arrival: "2099-10-22T09:40",
};

const status = (overrides: Partial<FlightStatus>): FlightStatus => ({
  flight: "LA3300",
  date: "2099-10-22",
  origin: "GRU",
  destination: "BSB",
  scheduledDeparture: "2099-10-22T11:00:00Z",
  scheduledArrival: "2099-10-22T12:40:00Z",
  actualDeparture: null,
  actualArrival: null,
  state: "scheduled",
  arrivalDelayMinutes: null,
  ...overrides,
});

describe("what a flight source says of a leg ONE follows", () => {
  it("keeps a delay as when the leg is now expected, in its destination's local time", () => {
    expect(
      legReadingOf(
        LEG,
        status({
          state: "departed",
          actualDeparture: "2099-10-22T15:00:00Z",
          estimatedArrival: "2099-10-22T17:40:00Z",
        }),
      ),
    ).toEqual({
      position: 1,
      status: "delayed",
      estimated_arrival: "2099-10-22T14:40",
      departed: "2099-10-22T12:00",
      arrived: null,
    });
  });

  it("calls a few minutes late on time, and keeps the minutes", () => {
    expect(legReadingOf(LEG, status({ estimatedArrival: "2099-10-22T12:50:00Z" }))).toEqual({
      position: 1,
      status: "scheduled",
      estimated_arrival: "2099-10-22T09:50",
      departed: null,
      arrived: null,
    });
    expect(legReadingOf(LEG, status({ estimatedArrival: "2099-10-22T12:30:00Z" }))).toEqual({
      position: 1,
      status: "scheduled",
      estimated_arrival: null,
      departed: null,
      arrived: null,
    });
  });

  it("keeps a landing with when it landed, a cancellation and a diversion with nothing expected", () => {
    expect(
      legReadingOf(
        LEG,
        status({ state: "landed", actualArrival: "2099-10-22T18:10:00Z", estimatedArrival: "2099-10-22T18:10:00Z" }),
      ),
    ).toEqual({
      position: 1,
      status: "landed",
      estimated_arrival: "2099-10-22T15:10",
      departed: null,
      arrived: "2099-10-22T15:10",
    });
    expect(legReadingOf(LEG, status({ state: "cancelled", actualDeparture: "2099-10-22T11:05:00Z" }))).toEqual({
      position: 1,
      status: "cancelled",
      estimated_arrival: null,
      departed: null,
      arrived: null,
    });
    expect(legReadingOf(LEG, status({ state: "diverted", actualDeparture: "2099-10-22T11:05:00Z" }))).toEqual({
      position: 1,
      status: "changed",
      estimated_arrival: null,
      departed: "2099-10-22T08:05",
      arrived: null,
    });
  });

  it("keeps when a leg left and arrived, in the local times of its airports", () => {
    // Left five minutes late from GRU and landed two minutes early at BSB: the ticket's local times, moved.
    expect(
      legReadingOf(
        LEG,
        status({
          state: "landed",
          actualDeparture: "2099-10-22T11:05:00Z",
          actualArrival: "2099-10-22T12:38:00Z",
          estimatedArrival: "2099-10-22T12:38:00Z",
        }),
      ),
    ).toMatchObject({ status: "landed", departed: "2099-10-22T08:05", arrived: "2099-10-22T09:38" });
    // In the air: it left, and has not arrived.
    expect(
      legReadingOf(
        LEG,
        status({
          state: "departed",
          actualDeparture: "2099-10-22T11:02:00Z",
          estimatedArrival: "2099-10-22T12:45:00Z",
        }),
      ),
    ).toMatchObject({ status: "scheduled", departed: "2099-10-22T08:02", arrived: null });
  });

  it("says nothing of a flight the source does not know", () => {
    expect(legReadingOf(LEG, null)).toBeNull();
  });

  it("reads the legs the database hands over, and the local times of an instant", () => {
    expect(
      followedLegsOf([
        {
          position: 1,
          flight_number: "LA3300",
          origin: "GRU",
          destination: "BSB",
          departure: "2099-10-22T08:00",
          arrival: "2099-10-22T09:40",
        },
        { position: 2, flight_number: "LA3301" },
      ]),
    ).toEqual([LEG]);
    expect(shiftLocal("2099-12-31T23:30", 45)).toBe("2100-01-01T00:15");
    expect(shiftLocal("ontem", 45)).toBeNull();
    expect(localDay("2099-10-22T08:00")).toBe("2099-10-22");
    expect(localOf("2099-10-22T11:00:00Z", "America/Sao_Paulo")).toBe("2099-10-22T08:00");
    expect(localOf("2099-10-22T11:00:00Z", "America/Manaus")).toBe("2099-10-22T07:00");
    expect(localOf("não é hora", "America/Sao_Paulo")).toBeNull();
  });

  it("takes a flight as a tester types it, and a day FlightAware keeps in sight", () => {
    expect(flightNumberOf(" la 3300 ")).toBe("LA3300");
    expect(flightNumberOf("G3 1010")).toBe("G31010");
    expect(flightNumberOf("voo")).toBeNull();
    expect(followableDay("2099-10-21", "2099-10-22")).toBe(true);
    expect(followableDay("2099-10-24", "2099-10-22")).toBe(true);
    expect(followableDay("2099-10-25", "2099-10-22")).toBe(false);
    expect(followableDay("2099-10-20", "2099-10-22")).toBe(false);
  });
});
