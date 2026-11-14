import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * When the backend's sweeps run (the owner's decision of 2026-11-04). Pure: what is due at a moment, and in which
 * order, decided from the clock alone.
 *
 * The work a person waits on is done right after their answer (`lib/jobs/soon.ts`), never through a queue.
 * What is left (a work that failed, one that waits for an hour of the day, the upkeep) is the sweeps': one clock,
 * on ONE's own server since 2026-11-14 (`clock/main.ts`, from the same commit as the app), beats every five
 * minutes and runs every sweep due at that beat, one beat at a time. While somebody uses ONE and the clock has been
 * silent, the sweeps that serve what people wait on also run now and then on the app's host
 * (`lib/jobs/while-used.ts`), so a server that stops holds nothing a person is looking at.
 */

/** The clock's beat, in minutes: it beats every five. */
export const TICK_MINUTES = 5;

/** When the clock runs a sweep: every so many minutes, at a minute of every hour, or at a time of every day (UTC). */
export type SweepWhen = { every: 5 | 10 | 15 | 30 } | { hourly: number } | { daily: { hour: number; minute: number } };

/** What a sweep did, in counts and switches only: it goes to the clock's log, and nothing of a person goes there. */
export type SweepReport = Record<string, unknown>;

export type Sweep = {
  /** Its name in the record of a beat. */
  key: string;
  when: SweepWhen;
  /**
   * Also run while somebody uses ONE: it serves what a person waits on (a reading, ONE's answer, a check, a
   * notice) and is safe to run from any server at once, since the database claims each work under a number.
   */
  whileUsed?: boolean;
  /** Runs one round; `until` is the moment by which it claims nothing more. Throws only when it could not run. */
  run: (service: SupabaseClient, until: number) => Promise<SweepReport>;
};

/** The beat a moment falls in: the start of its five minutes, in minutes since the epoch. */
export function slotOf(at: number): number {
  return Math.floor(at / 60_000 / TICK_MINUTES) * TICK_MINUTES;
}

/** Whether the clock runs a sweep at a beat. */
export function dueAt(when: SweepWhen, slot: number): boolean {
  const minuteOfDay = ((slot % 1440) + 1440) % 1440;
  const minuteOfHour = minuteOfDay % 60;
  if ("every" in when) return minuteOfHour % when.every === 0;
  if ("hourly" in when) return minuteOfHour === when.hourly;
  return minuteOfDay === when.daily.hour * 60 + when.daily.minute;
}

/** Whether a schedule is one the clock can meet: its minutes fall on a beat. */
export function isValidWhen(when: SweepWhen): boolean {
  if ("every" in when) return [5, 10, 15, 30].includes(when.every);
  if ("hourly" in when)
    return Number.isInteger(when.hourly) && when.hourly >= 0 && when.hourly < 60 && when.hourly % TICK_MINUTES === 0;
  const { hour, minute } = when.daily;
  return (
    Number.isInteger(hour) &&
    Number.isInteger(minute) &&
    hour >= 0 &&
    hour < 24 &&
    minute >= 0 &&
    minute < 60 &&
    minute % TICK_MINUTES === 0
  );
}

/** A list turned by a beat, so what ran out of time at one beat goes first at another. */
export function inTurn<T>(items: readonly T[], slot: number): T[] {
  if (items.length === 0) return [];
  const offset = Math.floor(slot / TICK_MINUTES) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

/**
 * What the clock runs at a beat, in order: what runs once a day or an hour first (it has only this beat), then the
 * frequent ones, turned by the beat.
 */
export function clockOrder(sweeps: readonly Sweep[], slot: number): Sweep[] {
  const due = sweeps.filter((sweep) => dueAt(sweep.when, slot));
  const rare = due.filter((sweep) => !("every" in sweep.when));
  const frequent = due.filter((sweep) => "every" in sweep.when);
  return [...rare, ...inTurn(frequent, slot)];
}

/** What runs while somebody uses ONE: the sweeps that serve what people wait on, whatever the clock says, turned. */
export function whileUsedOrder(sweeps: readonly Sweep[], slot: number): Sweep[] {
  return inTurn(
    sweeps.filter((sweep) => sweep.whileUsed),
    slot,
  );
}
