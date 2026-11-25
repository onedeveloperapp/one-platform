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
export const PULSE_IDLE_MS = 20_000;
/**
 * Right after the person's own action (the audit of the case's sync, 2026-11-25): what ONE starts from it begins
 * within a second, and four seconds of a still screen after "saved" read as nothing happening, then as a notice out
 * of nowhere. The pulse is one light question to the database (about ten milliseconds for the fullest case), asked by
 * the browser, so half a minute of it costs nothing that matters.
 */
export const PULSE_HOT_MS = 1_500;
export const PULSE_HOT_FOR_MS = 30_000;
/** While ONE is at work on what the screen shows: its notice opens and closes with the work, never seconds after. */
export const PULSE_BUSY_MS = 2_000;
/** After the hot half minute, the screen still reads as if ONE might act for this long after the person's action. */
export const PULSE_WARM_MS = 4_000;
export const PULSE_AFTER_ACTION_MS = 120_000;
/** A pulse that could not be read is asked again only after this long. */
export const PULSE_FAILED_MS = 60_000;

export function pulseDelay(input: { busy: boolean; actedAt: number | null; now: number; failed: boolean }): number {
  if (input.failed) return PULSE_FAILED_MS;
  const sinceAction = input.actedAt === null ? null : input.now - input.actedAt;
  if (sinceAction !== null && sinceAction < PULSE_HOT_FOR_MS) return PULSE_HOT_MS;
  if (input.busy) return PULSE_BUSY_MS;
  if (sinceAction !== null && sinceAction < PULSE_AFTER_ACTION_MS) return PULSE_WARM_MS;
  return PULSE_IDLE_MS;
}
