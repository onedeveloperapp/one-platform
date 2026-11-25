import { describe, expect, it } from "vitest";

import {
  casePulseOf,
  PULSE_BUSY_MS,
  PULSE_FAILED_MS,
  PULSE_HOT_MS,
  PULSE_IDLE_MS,
  PULSE_WARM_MS,
  pulseDelay,
} from "@/lib/cases/pulse";

const NOW = Date.parse("2026-11-25T14:00:00Z");
const ago = (ms: number) => NOW - ms;

describe("how often a screen asks its pulse", () => {
  it("asks every second and a half for half a minute after the person's own action", () => {
    expect(pulseDelay({ busy: false, actedAt: ago(0), now: NOW, failed: false })).toBe(PULSE_HOT_MS);
    expect(pulseDelay({ busy: false, actedAt: ago(29_000), now: NOW, failed: false })).toBe(PULSE_HOT_MS);
    // ONE at work does not slow the screen right after the action.
    expect(pulseDelay({ busy: true, actedAt: ago(5_000), now: NOW, failed: false })).toBe(PULSE_HOT_MS);
  });

  it("asks every two seconds while ONE works on what the screen shows", () => {
    expect(pulseDelay({ busy: true, actedAt: null, now: NOW, failed: false })).toBe(PULSE_BUSY_MS);
    expect(pulseDelay({ busy: true, actedAt: ago(45_000), now: NOW, failed: false })).toBe(PULSE_BUSY_MS);
  });

  it("stays attentive for two minutes after an action, then goes back to the quiet pace", () => {
    expect(pulseDelay({ busy: false, actedAt: ago(45_000), now: NOW, failed: false })).toBe(PULSE_WARM_MS);
    expect(pulseDelay({ busy: false, actedAt: ago(121_000), now: NOW, failed: false })).toBe(PULSE_IDLE_MS);
    expect(pulseDelay({ busy: false, actedAt: null, now: NOW, failed: false })).toBe(PULSE_IDLE_MS);
  });

  it("asks a pulse that could not be read only after a minute, whatever else", () => {
    expect(pulseDelay({ busy: true, actedAt: ago(1_000), now: NOW, failed: true })).toBe(PULSE_FAILED_MS);
  });

  it("the paces are in order: hot, at work, attentive, quiet", () => {
    expect(PULSE_HOT_MS).toBeLessThan(PULSE_BUSY_MS);
    expect(PULSE_BUSY_MS).toBeLessThan(PULSE_WARM_MS);
    expect(PULSE_WARM_MS).toBeLessThan(PULSE_IDLE_MS);
  });
});

describe("the pulse of a case as the database answers it", () => {
  it("reads the mark and whether ONE looks at the case now or owes it a look", () => {
    expect(
      casePulseOf({
        stamp: "0123456789abcdef0123456789abcdef",
        advance: { running: true, due: false, waiting_since: "2026-11-25T13:59:00Z", checked_at: null },
      }),
    ).toEqual({
      stamp: "0123456789abcdef0123456789abcdef",
      advance: { running: true, due: false, waitingSince: "2026-11-25T13:59:00Z", checkedAt: null },
    });
  });

  it("refuses an answer with no mark: a pulse that is not one is never the screen's", () => {
    expect(casePulseOf({ stamp: "curto", advance: {} })).toBeNull();
    expect(casePulseOf(null)).toBeNull();
  });
});
