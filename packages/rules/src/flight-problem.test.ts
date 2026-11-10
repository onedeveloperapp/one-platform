import assert from "node:assert/strict";
import test from "node:test";

import {
  assistanceDue,
  FLIGHT_PROBLEM_RULE,
  flightProblem,
  flightProblems,
  inFlightOrder,
  journeysOf,
  minutesBetween,
  type WatchedLeg,
} from "./flight-problem.ts";

// Every flight here is invented; the times are local, at each leg's own airports.

const leg = (overrides: Partial<WatchedLeg>): WatchedLeg => ({
  position: 1,
  scheduledDeparture: "2099-10-22T08:10:00",
  scheduledArrival: "2099-10-22T11:25:00",
  status: "scheduled",
  estimatedArrival: null,
  ...overrides,
});

const RULE = { delayMinutes: 240 };

test("minutes between two local times of one airport, across midnight and months", () => {
  assert.equal(minutesBetween("2099-10-22T11:25:00", "2099-10-22T17:25:00"), 360);
  assert.equal(minutesBetween("2099-10-31T23:30", "2099-11-01 01:00"), 90);
  assert.equal(minutesBetween("2099-10-22T11:25:00", "não é uma hora"), null);
});

test("a trip with nothing wrong, or a delay under the setting, tells nothing", () => {
  assert.equal(flightProblem([], RULE), null);
  assert.equal(flightProblem([leg({})], RULE), null);
  assert.equal(flightProblem([leg({ status: "delayed", estimatedArrival: "2099-10-22T13:25:00" })], RULE), null);
  assert.equal(flightProblem([leg({ status: "delayed", estimatedArrival: "2099-10-22T15:24:00" })], RULE), null);
  assert.equal(flightProblem([leg({ status: "landed", estimatedArrival: "2099-10-22T11:20:00" })], RULE), null);
});

test("a delay at the destination of the setting or more is told, by how much", () => {
  assert.deepEqual(flightProblem([leg({ status: "delayed", estimatedArrival: "2099-10-22T15:25:00" })], RULE), {
    kind: "delayed",
    leg: 1,
    delayMinutes: 240,
  });
  assert.deepEqual(flightProblem([leg({ status: "delayed", estimatedArrival: "2099-10-22T17:25:00" })], RULE), {
    kind: "delayed",
    leg: 1,
    delayMinutes: 360,
  });
  // The setting decides: a firm's rule of two hours tells a two-hour delay.
  assert.equal(
    flightProblem([leg({ status: "delayed", estimatedArrival: "2099-10-22T13:25:00" })], { delayMinutes: 120 })?.kind,
    "delayed",
  );
});

test("a connection lost is told by the leg that lands late at the destination", () => {
  const legs = [
    leg({
      position: 2,
      scheduledDeparture: "2099-10-22T09:30:00",
      scheduledArrival: "2099-10-22T11:05:00",
      status: "delayed",
      estimatedArrival: "2099-10-22T18:05:00",
    }),
    leg({
      position: 1,
      scheduledDeparture: "2099-10-22T07:00:00",
      scheduledArrival: "2099-10-22T08:20:00",
      status: "delayed",
      estimatedArrival: "2099-10-22T11:20:00",
    }),
  ];
  assert.deepEqual(flightProblem(legs, RULE), { kind: "delayed", leg: 2, delayMinutes: 420 });
  // The first leg late and the second on time: the passenger made the connection, nothing to tell.
  assert.equal(flightProblem([legs[1], { ...legs[0], status: "scheduled", estimatedArrival: null }], RULE), null);
});

test("a round trip is two journeys: the way out landing late is told, however the legs are numbered", () => {
  const out = leg({
    position: 2,
    origin: "GRU",
    destination: "REC",
    scheduledDeparture: "2099-10-22T08:10:00",
    scheduledArrival: "2099-10-22T11:25:00",
    status: "landed",
    estimatedArrival: "2099-10-22T17:40:00",
  });
  const back = leg({
    position: 1,
    origin: "REC",
    destination: "GRU",
    scheduledDeparture: "2099-10-29T18:00:00",
    scheduledArrival: "2099-10-29T21:20:00",
  });
  assert.deepEqual(flightProblem([back, out], RULE), { kind: "delayed", leg: 2, delayMinutes: 375 });
  // The way out on time and the way back late: the way back is told.
  assert.deepEqual(
    flightProblem(
      [
        { ...out, status: "landed", estimatedArrival: "2099-10-22T11:30:00" },
        { ...back, status: "delayed", estimatedArrival: "2099-10-30T02:00:00" },
      ],
      RULE,
    ),
    { kind: "delayed", leg: 1, delayMinutes: 280 },
  );
});

test("a connection keeps a journey going; a stay of more than a day, or another airport, ends it", () => {
  const first = leg({ origin: "GYN", destination: "GRU", scheduledArrival: "2099-10-22T09:30:00" });
  const next = (departure: string, origin = "GRU") =>
    leg({
      position: 2,
      origin,
      destination: "LIS",
      scheduledDeparture: departure,
      scheduledArrival: "2099-10-23T09:00:00",
    });
  assert.equal(journeysOf([first, next("2099-10-22T21:00:00")]).length, 1);
  assert.equal(journeysOf([first, next("2099-10-23T10:00:00")]).length, 2);
  assert.equal(journeysOf([first, next("2099-10-22T21:00:00", "VCP")]).length, 2);
  // With no airports, the time alone decides.
  assert.equal(
    journeysOf([
      { ...first, destination: null },
      { ...next("2099-10-22T21:00:00"), origin: null },
    ]).length,
    1,
  );
  assert.deepEqual(
    inFlightOrder([next("2099-10-22T21:00:00"), first]).map((item) => item.origin),
    ["GYN", "GRU"],
  );
});

test("a cancellation is told before a change, and a change before a delay", () => {
  const late = leg({ position: 2, status: "delayed", estimatedArrival: "2099-10-22T19:25:00" });
  assert.deepEqual(flightProblem([leg({ status: "changed" }), late], RULE), {
    kind: "changed",
    leg: 1,
    delayMinutes: null,
  });
  assert.deepEqual(flightProblem([leg({ status: "changed" }), { ...late, status: "cancelled" }], RULE), {
    kind: "cancelled",
    leg: 2,
    delayMinutes: null,
  });
});

test("what the airline owes, by ANAC's rules and the time waited (Resolução 813/2026: no means of communication)", () => {
  assert.deepEqual(assistanceDue({ kind: "cancelled", leg: 1, delayMinutes: null }), [
    "rebooking_or_refund",
    "food",
    "lodging",
  ]);
  assert.deepEqual(assistanceDue({ kind: "changed", leg: 1, delayMinutes: null }), ["rebooking_or_refund"]);
  assert.deepEqual(assistanceDue({ kind: "delayed", leg: 1, delayMinutes: 90 }), []);
  assert.deepEqual(assistanceDue({ kind: "delayed", leg: 1, delayMinutes: 150 }), ["food"]);
  assert.deepEqual(assistanceDue({ kind: "delayed", leg: 1, delayMinutes: 360 }), [
    "rebooking_or_refund",
    "food",
    "lodging",
  ]);
});

test("v4 reads each journey on its own: the way back has a problem of its own", () => {
  assert.equal(FLIGHT_PROBLEM_RULE, "flight-problem-v4");
  const out = leg({ position: 1, origin: "GRU", destination: "REC", status: "cancelled" });
  const back = leg({
    position: 2,
    origin: "REC",
    destination: "GRU",
    scheduledDeparture: "2099-10-29T18:00:00",
    scheduledArrival: "2099-10-29T21:15:00",
    status: "delayed",
    estimatedArrival: "2099-10-30T02:00:00",
  });
  assert.deepEqual(flightProblems([back, out], RULE), [
    { kind: "cancelled", leg: 1, delayMinutes: null, journey: 1, legs: [1] },
    { kind: "delayed", leg: 2, delayMinutes: 285, journey: 2, legs: [2] },
  ]);
  // The way back alone, the outbound flown as it should.
  assert.deepEqual(flightProblems([{ ...out, status: "landed" }, back], RULE), [
    { kind: "delayed", leg: 2, delayMinutes: 285, journey: 2, legs: [2] },
  ]);
  // A delay under the setting is nothing; a trip with nothing has no problem.
  assert.deepEqual(flightProblems([{ ...back, estimatedArrival: "2099-10-29T22:00:00" }], RULE), []);
  assert.deepEqual(flightProblems([], RULE), []);
  // The first of them is still the trip's problem, as v3 said it.
  assert.deepEqual(flightProblem([back, out], RULE), { kind: "cancelled", leg: 1, delayMinutes: null });
});

test("v4 says the legs of a journey with a connection, and its change before a delay", () => {
  const first = leg({ position: 1, origin: "GYN", destination: "GRU", scheduledArrival: "2099-10-22T10:00:00" });
  const second = leg({
    position: 2,
    origin: "GRU",
    destination: "REC",
    scheduledDeparture: "2099-10-22T12:00:00",
    scheduledArrival: "2099-10-22T15:20:00",
    status: "changed",
  });
  assert.deepEqual(flightProblems([first, second], RULE), [
    { kind: "changed", leg: 2, delayMinutes: null, journey: 1, legs: [1, 2] },
  ]);
});
