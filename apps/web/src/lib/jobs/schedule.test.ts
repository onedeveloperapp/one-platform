import { describe, expect, it } from "vitest";

import {
  clockOrder,
  dueAt,
  inTurn,
  isValidWhen,
  slotOf,
  slowestSweeps,
  type Sweep,
  type SweepWhen,
  TICK_MINUTES,
  whileUsedOrder,
} from "@/lib/jobs/schedule";

/** The slot of an hour and minute of a day (UTC), as the clock's beat gives it. */
const at = (hour: number, minute: number, second = 0) => Date.UTC(2026, 10, 4, hour, minute, second);
const slot = (hour: number, minute: number) => slotOf(at(hour, minute));

const sweep = (key: string, when: SweepWhen, whileUsed = false): Sweep => ({
  key,
  when,
  whileUsed,
  run: async () => ({}),
});

describe("the clock's beat (2026-11-04)", () => {
  it("falls on the start of its five minutes, whatever second the beat started at", () => {
    expect(TICK_MINUTES).toBe(5);
    expect(slotOf(at(10, 0, 7))).toBe(slot(10, 0));
    expect(slotOf(at(10, 4, 59))).toBe(slot(10, 0));
    expect(slotOf(at(10, 5, 0))).toBe(slot(10, 5));
    expect(slot(10, 5) - slot(10, 0)).toBe(5);
  });

  it("runs a sweep every so many minutes, at a minute of each hour, or at a time of each day (UTC)", () => {
    expect(dueAt({ every: 5 }, slot(10, 35))).toBe(true);
    expect(dueAt({ every: 10 }, slot(10, 30))).toBe(true);
    expect(dueAt({ every: 10 }, slot(10, 35))).toBe(false);
    expect(dueAt({ every: 15 }, slot(10, 45))).toBe(true);
    expect(dueAt({ every: 15 }, slot(10, 40))).toBe(false);
    expect(dueAt({ every: 30 }, slot(10, 0))).toBe(true);
    expect(dueAt({ every: 30 }, slot(10, 15))).toBe(false);
    expect(dueAt({ hourly: 20 }, slot(3, 20))).toBe(true);
    expect(dueAt({ hourly: 20 }, slot(3, 25))).toBe(false);
    expect(dueAt({ daily: { hour: 4, minute: 30 } }, slot(4, 30))).toBe(true);
    expect(dueAt({ daily: { hour: 4, minute: 30 } }, slot(16, 30))).toBe(false);
    expect(dueAt({ daily: { hour: 0, minute: 0 } }, slot(0, 0))).toBe(true);
  });

  it("accepts only schedules whose minutes fall on a beat", () => {
    expect(isValidWhen({ every: 5 })).toBe(true);
    expect(isValidWhen({ every: 7 as 5 })).toBe(false);
    expect(isValidWhen({ hourly: 20 })).toBe(true);
    expect(isValidWhen({ hourly: 22 })).toBe(false);
    expect(isValidWhen({ daily: { hour: 13, minute: 15 } })).toBe(true);
    expect(isValidWhen({ daily: { hour: 13, minute: 17 } })).toBe(false);
    expect(isValidWhen({ daily: { hour: 24, minute: 0 } })).toBe(false);
  });

  it("turns the frequent sweeps by the beat, so the one left out of time goes first at another", () => {
    const items = ["a", "b", "c"];
    const firsts = new Set([0, 5, 10].map((minute) => inTurn(items, slot(10, minute))[0]));
    expect(firsts).toEqual(new Set(items));
    for (const minute of [0, 5, 10, 15]) expect([...inTurn(items, slot(10, minute))].sort()).toEqual(items);
    expect(inTurn([], slot(10, 0))).toEqual([]);
  });

  it("runs what has only this beat first, then the frequent ones due, and nothing that is not due", () => {
    const sweeps = [
      sweep("five", { every: 5 }),
      sweep("ten", { every: 10 }),
      sweep("night", { daily: { hour: 4, minute: 30 } }),
      sweep("hour", { hourly: 30 }),
    ];
    const order = clockOrder(sweeps, slot(4, 30)).map((item) => item.key);
    expect(order.slice(0, 2)).toEqual(["night", "hour"]);
    expect([...order.slice(2)].sort()).toEqual(["five", "ten"]);
    expect(clockOrder(sweeps, slot(4, 35)).map((item) => item.key)).toEqual(["five"]);
  });

  it("runs, while ONE is used, only the sweeps that serve what people wait on, whatever the clock says", () => {
    const sweeps = [
      sweep("reading", { every: 5 }, true),
      sweep("capture", { every: 5 }),
      sweep("notices", { every: 10 }, true),
      sweep("backup", { daily: { hour: 3, minute: 0 } }),
    ];
    expect(
      whileUsedOrder(sweeps, slot(4, 35))
        .map((item) => item.key)
        .sort(),
    ).toEqual(["notices", "reading"]);
  });
});

describe("the slow sweeps the clock's log names (2026-11-24)", () => {
  it("names each sweep of a second or more, the slowest first, in whole milliseconds, and nothing else", () => {
    const named = slowestSweeps({
      "djen-cases": 14_220.4,
      "case-advance": 31_800,
      quick: 999,
      again: 31_800,
      odd: Number.NaN,
    });
    expect(named).toEqual({ again: 31_800, "case-advance": 31_800, "djen-cases": 14_220 });
    expect(Object.keys(named)).toEqual(["again", "case-advance", "djen-cases"]);
    expect(slowestSweeps({})).toEqual({});
  });
});
