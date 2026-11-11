import { describe, expect, it } from "vitest";

import {
  type DayLeg,
  dayParams,
  type DayTrip,
  dayTripsOf,
  dayWordsDue,
} from "@/modules/direito-do-passageiro/flight-alerts/trip-day";

// Every flight and person here is invented.

const NOW = new Date("2099-10-22T12:00:00Z");
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();

const leg = (overrides: Partial<DayLeg>): DayLeg => ({
  position: 1,
  flightNumber: "LA3456",
  origin: "GYN",
  destination: "GRU",
  originCity: "Goiânia",
  destinationCity: "São Paulo",
  departure: "2099-10-22T10:30:00",
  arrival: "2099-10-22T12:15:00",
  status: "scheduled",
  estimatedArrival: null,
  departureAt: at(90),
  arrivalAt: at(195),
  caseId: null,
  ...overrides,
});

const trip = (legs: DayLeg[], more: Partial<DayTrip> = {}): DayTrip => ({
  tripId: "trip",
  test: false,
  passengerName: "Mariana Teste",
  firm: "Souza Advogados",
  legs,
  written: [],
  alerted: [],
  ...more,
});

describe("the day of a trip", () => {
  it("wishes a good trip within two hours of a journey's departure, once", () => {
    expect(dayWordsDue(trip([leg({})]), NOW).map((word) => [word.journey, word.kind])).toEqual([[1, "departure"]]);
    expect(dayWordsDue(trip([leg({ departureAt: at(150) })]), NOW)).toEqual([]);
    expect(dayWordsDue(trip([leg({ departureAt: at(-5) })]), NOW)).toEqual([]);
    expect(dayWordsDue(trip([leg({})], { written: [{ journey: 1, kind: "departure" }] }), NOW)).toEqual([]);
  });

  it("asks whether all went well from half an hour after the journey lands, for three hours", () => {
    const landed = leg({ departureAt: at(-200), arrivalAt: at(-40), status: "landed" });
    expect(dayWordsDue(trip([landed]), NOW).map((word) => word.kind)).toEqual(["arrival"]);
    expect(dayWordsDue(trip([{ ...landed, arrivalAt: at(-10) }]), NOW)).toEqual([]);
    expect(dayWordsDue(trip([{ ...landed, arrivalAt: at(-200) }]), NOW)).toEqual([]);
  });

  it("writes nothing of a journey cancelled, told of a problem, or taken by a case", () => {
    expect(dayWordsDue(trip([leg({ status: "cancelled" })]), NOW)).toEqual([]);
    expect(dayWordsDue(trip([leg({})], { alerted: [1] }), NOW)).toEqual([]);
    expect(dayWordsDue(trip([leg({ caseId: "case" })]), NOW)).toEqual([]);
  });

  it("reads each journey of a round trip on its own", () => {
    const out = leg({ departureAt: at(-300), arrivalAt: at(-60), status: "landed" });
    const back = leg({
      position: 2,
      flightNumber: "LA3457",
      origin: "GRU",
      destination: "GYN",
      departure: "2099-10-29T18:00:00",
      arrival: "2099-10-29T19:45:00",
      departureAt: at(60 * 24 * 7),
      arrivalAt: at(60 * 24 * 7 + 105),
    });
    expect(dayWordsDue(trip([out, back]), NOW).map((word) => [word.journey, word.kind])).toEqual([[1, "arrival"]]);
  });

  it("in the test chat, goes by what the tester made happen", () => {
    const later = leg({ departureAt: at(60 * 24 * 3), arrivalAt: at(60 * 24 * 3 + 105) });
    expect(dayWordsDue(trip([later]), NOW, { kind: "depart", position: 1 }).map((word) => word.kind)).toEqual([
      "departure",
    ]);
    expect(dayWordsDue(trip([later]), NOW, { kind: "land", position: 1 }).map((word) => word.kind)).toEqual([
      "arrival",
    ]);
    expect(dayWordsDue(trip([later]), NOW, { kind: "land", position: 2 })).toEqual([]);
  });

  it("says the first name, the firm and the journey's flights", () => {
    const one = trip([leg({})]);
    const [word] = dayWordsDue(one, NOW);
    expect(dayParams(one, word)).toEqual([
      "Mariana",
      "Souza Advogados",
      "LA 3456 de Goiânia (GYN) para São Paulo (GRU), de 22/10/2099",
    ]);
  });

  it("reads the database's answer, leaving out what is not a trip", () => {
    const read = dayTripsOf([
      {
        trip_id: "t1",
        test: true,
        passenger_name: "Mariana Teste",
        firm: "Souza Advogados",
        legs: [
          {
            position: 1,
            flight_number: "LA3456",
            origin: "GYN",
            destination: "GRU",
            departure: "2099-10-22T10:30:00",
            arrival: "2099-10-22T12:15:00",
            status: "scheduled",
            departure_at: at(90),
            arrival_at: at(195),
          },
        ],
        written: [{ journey: 1, kind: "departure" }],
        alerted: [2],
      },
      { legs: [] },
    ]);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({
      tripId: "t1",
      test: true,
      written: [{ journey: 1, kind: "departure" }],
      alerted: [2],
    });
    expect(read[0].legs[0]).toMatchObject({ flightNumber: "LA3456", caseId: null, originCity: null });
  });
});
