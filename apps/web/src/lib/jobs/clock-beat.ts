/**
 * The mark each beat of the clock leaves in the database (`platform_settings`, never public): when it beat, where it
 * runs and from which commit (`clock/main.ts`). The app reads it to know whether the clock is alive. Pure.
 */
export const CLOCK_BEAT_KEY = "clock_beat";

export type ClockBeat = { at: string; host: string; commit: string };

/** The clock is silent once its last beat is older than three beats: the app then runs its own rounds. */
export const CLOCK_SILENT_MS = 15 * 60_000;

/** Whether the clock beat lately, from the value of its mark as the database keeps it. */
export function clockAlive(value: unknown, now: number): boolean {
  const at = value && typeof value === "object" ? (value as { at?: unknown }).at : null;
  if (typeof at !== "string") return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && now - time < CLOCK_SILENT_MS && time - now < CLOCK_SILENT_MS;
}
