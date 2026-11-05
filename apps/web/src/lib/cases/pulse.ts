/**
 * The pulse of a case (migration 0096, `case_pulse`): a mark that changes whenever anything its screen shows
 * changes, and whether ONE is looking at the case now or owes it a look. Pure: the answer of the database, read.
 */
export type CasePulse = {
  stamp: string;
  advance: { running: boolean; due: boolean; waitingSince: string | null; checkedAt: string | null };
};

const STAMP = /^[0-9a-f]{32}$/;

export function casePulseOf(raw: unknown): CasePulse | null {
  const row = (raw ?? null) as { stamp?: unknown; advance?: unknown } | null;
  if (!row || typeof row.stamp !== "string" || !STAMP.test(row.stamp)) return null;
  const advance = (row.advance ?? {}) as Record<string, unknown>;
  return {
    stamp: row.stamp,
    advance: {
      running: advance.running === true,
      due: advance.due === true,
      waitingSince: typeof advance.waiting_since === "string" ? advance.waiting_since : null,
      checkedAt: typeof advance.checked_at === "string" ? advance.checked_at : null,
    },
  };
}

/** The pulse of a firm's home (0096, `firm_pulse`): its mark alone. */
export function firmPulseOf(raw: unknown): string | null {
  const row = (raw ?? null) as { stamp?: unknown } | null;
  return row && typeof row.stamp === "string" && STAMP.test(row.stamp) ? row.stamp : null;
}

/**
 * How long a screen waits before it asks its pulse again (the owner's audit, 2026-11-05): a few seconds while ONE
 * is at work there, or right after the person did something that sets ONE to work (what it does then takes seconds
 * to a minute or two), and longer otherwise, since a client or ONE's clock may still change it; never while the tab
 * is hidden (asked again as soon as it is in front of the person).
 */
export const PULSE_BUSY_MS = 4_000;
export const PULSE_IDLE_MS = 20_000;
/** After the person's own action, the screen reads as if ONE were at work for this long. */
export const PULSE_AFTER_ACTION_MS = 120_000;
/** A pulse that could not be read is asked again only after this long. */
export const PULSE_FAILED_MS = 60_000;

export function pulseDelay(input: { busy: boolean; actedAt: number | null; now: number; failed: boolean }): number {
  if (input.failed) return PULSE_FAILED_MS;
  if (input.busy) return PULSE_BUSY_MS;
  if (input.actedAt !== null && input.now - input.actedAt < PULSE_AFTER_ACTION_MS) return PULSE_BUSY_MS;
  return PULSE_IDLE_MS;
}
