// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  type FlightLeg,
  flightProgress,
  flightTripsOf,
  lastRead,
  stepTimeLabel,
} from "@/modules/direito-do-passageiro/agency/flight-progress";

// Every flight and person here is invented.

const leg = (overrides: Partial<FlightLeg> = {}): FlightLeg => ({
  position: 1,
  flightNumber: "LA3100",
  origin: "GRU",
  destination: "BSB",
  departure: "2099-11-20T06:10",
  arrival: "2099-11-20T07:50",
  status: "scheduled",
  estimatedArrival: null,
  departed: null,
  arrived: null,
  statusAt: null,
  ...overrides,
});
const second = (overrides: Partial<FlightLeg> = {}): FlightLeg =>
  leg({
    position: 2,
    flightNumber: "LA3200",
    origin: "BSB",
    destination: "REC",
    departure: "2099-11-20T09:00",
    arrival: "2099-11-20T11:40",
    ...overrides,
  });

describe("the steps of a flight", () => {
  it("waits for the first departure while no source said it left, however late it is", () => {
    const progress = flightProgress([leg(), second()]);
    expect(progress.steps.map((step) => [step.key, step.state])).toEqual([
      ["1:departure", "next"],
      ["1:arrival", "next"],
      ["2:departure", "next"],
      ["2:arrival", "next"],
    ]);
    expect(progress).toMatchObject({
      reached: 0,
      started: false,
      state: "progress",
      now: { kind: "before", flightNumber: "LA3100", airport: "GRU", at: "2099-11-20T06:10" },
    });
  });

  it("is in the air once a leg left, with when it is expected", () => {
    const progress = flightProgress([leg({ departed: "2099-11-20T06:25", estimatedArrival: "2099-11-20T08:05" })]);
    expect(progress.steps[0]).toMatchObject({ state: "done", at: "2099-11-20T06:25", late: true });
    expect(progress.now).toEqual({
      kind: "in_air",
      flightNumber: "LA3100",
      from: "GRU",
      to: "BSB",
      at: "2099-11-20T08:05",
      late: true,
    });
  });

  it("is between two flights after the first arrived, and arrived once the last did", () => {
    const between = flightProgress([
      leg({ status: "landed", departed: "2099-11-20T06:10", arrived: "2099-11-20T07:45" }),
      second(),
    ]);
    expect(between.now).toEqual({ kind: "connection", flightNumber: "LA3200", airport: "BSB", at: "2099-11-20T09:00" });
    expect(between.reached).toBe(2);
    const arrived = flightProgress([
      leg({ status: "landed", departed: "2099-11-20T06:10", arrived: "2099-11-20T07:45" }),
      second({ status: "landed", departed: "2099-11-20T09:05", arrived: "2099-11-20T11:30" }),
    ]);
    expect(arrived).toMatchObject({
      state: "done",
      reached: 3,
      now: { kind: "arrived", airport: "REC", at: "2099-11-20T11:30" },
    });
    expect(arrived.steps.every((step) => step.state === "done")).toBe(true);
  });

  it("takes a landing the source said, with no times, as the leg having left and arrived", () => {
    const progress = flightProgress([leg({ status: "landed" })]);
    expect(progress.state).toBe("done");
    expect(progress.steps[1]).toMatchObject({ at: "2099-11-20T07:50", late: false });
  });

  it("stops at a cancelled or changed leg, and says which", () => {
    const cancelled = flightProgress([leg({ status: "landed" }), second({ status: "cancelled" })]);
    expect(cancelled.steps.map((step) => step.state)).toEqual(["done", "done", "stopped", "next"]);
    expect(cancelled).toMatchObject({
      state: "stopped",
      reached: 2,
      now: { kind: "cancelled", flightNumber: "LA3200" },
    });
    expect(flightProgress([leg({ status: "changed", departed: "2099-11-20T06:10" })]).now).toEqual({
      kind: "changed",
      flightNumber: "LA3100",
    });
  });

  it("calls a delay late, and a few minutes on time", () => {
    expect(flightProgress([leg({ status: "delayed", estimatedArrival: "2099-11-20T13:50" })]).steps[1]?.late).toBe(
      true,
    );
    expect(flightProgress([leg({ estimatedArrival: "2099-11-20T07:55" })]).steps[1]?.late).toBe(false);
  });

  it("takes the legs in the order they fly, whatever their positions say", () => {
    const progress = flightProgress([second({ position: 1 }), leg({ position: 2 })]);
    expect(progress.steps[0]).toMatchObject({ airport: "GRU", key: "2:departure" });
  });

  it("has no steps for a trip with no legs", () => {
    expect(flightProgress([])).toEqual({ steps: [], reached: 0, started: false, state: "progress", now: null });
  });
});

describe("what the database answers", () => {
  it("is read into trips and legs, leaving out what it cannot read", () => {
    const read = flightTripsOf({
      days: 7,
      trips: [
        {
          trip_id: "t1",
          traveler_id: "p1",
          holder: "Mariana Teste",
          locator: "SOL123",
          state: "watching",
          source: "simulated",
          legs: [
            {
              position: 1,
              flight_number: "LA3100",
              origin: "GRU",
              destination: "BSB",
              departure: "2099-11-20T06:10",
              arrival: "2099-11-20T07:50",
              status: "landed",
              estimated_arrival: null,
              departed: "2099-11-20T06:12",
              arrived: "2099-11-20T07:48",
              status_at: "2099-11-20T10:49:00+00:00",
            },
            { position: 2, flight_number: "LA3200", status: "a status of tomorrow" },
          ],
        },
        { trip_id: "t2", traveler_id: "p2", state: "not a state", legs: [] },
      ],
    });
    expect(read?.days).toBe(7);
    expect(read?.trips).toHaveLength(1);
    expect(read?.trips[0]).toMatchObject({ holder: "Mariana Teste", source: "simulated", state: "watching" });
    expect(read?.trips[0]?.legs).toEqual([
      leg({
        status: "landed",
        departed: "2099-11-20T06:12",
        arrived: "2099-11-20T07:48",
        statusAt: "2099-11-20T10:49:00+00:00",
      }),
    ]);
    for (const answer of [null, undefined, "x", [], {}, { trips: "x" }]) expect(flightTripsOf(answer)).toBeNull();
  });

  it("says a time on the day asked about by its hour, and another day with it", () => {
    expect(stepTimeLabel("2099-11-20T06:10", "2099-11-20")).toBe("06:10");
    expect(stepTimeLabel("2099-11-21T06:10", "2099-11-20")).toBe("21/11 06:10");
    expect(stepTimeLabel("not a time", "2099-11-20")).toBe("");
  });

  it("knows when a trip's legs were last read", () => {
    expect(
      lastRead([leg({ statusAt: "2099-11-20T09:00:00+00:00" }), second({ statusAt: "2099-11-20T10:00:00+00:00" })]),
    ).toBe("2099-11-20T10:00:00+00:00");
    expect(lastRead([leg()])).toBeNull();
  });
});
