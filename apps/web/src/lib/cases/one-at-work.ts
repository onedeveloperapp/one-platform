import type { NowItem } from "@/lib/cases/now";

/**
 * The notice that holds a screen while ONE works on its record (the screen pattern after ADVBox, approved by the
 * owner on 2026-11-07): what ONE is doing there, its steps, and the screen given back, read again, once it ends.
 * Two safeguards, from the plan: it holds only for ONE's own work, which takes seconds or minutes, never for a wait
 * on the client or the court; and from about two minutes on it says ONE is taking longer than usual and offers to
 * go on without waiting, so a work that stalled never traps the screen. Pure, so each rule is tested.
 */

/** How long ONE works before the notice says it is taking longer than usual and lets the person go on. */
export const LONG_AFTER_MS = 120_000;

/**
 * The work that holds the screen: what ONE is doing there now, never what it will look at soon (nothing is under
 * way yet), a work it already said is late (the top says so, and holding the screen for it helps nobody), nor a work
 * that waits on somebody outside ONE (a court tried again later).
 */
export function holdingWork(working: readonly NowItem[]): NowItem[] {
  return working.filter((item) => item.owner === "one" && item.id !== "advance:due" && !item.slow && !item.outside);
}

/**
 * What ONE does next, where it always follows: a piece's text, once written, has what it cites read in the library.
 * Anything else is not foretold, since what follows depends on the firm's choices.
 */
export function nextStepOf(item: NowItem): string | null {
  const key = item.text.key;
  if (key === "case-now-draft-writing" || key === "case-now-draft-revising" || key === "case-now-draft-rewriting")
    return "one-at-work-next-citations";
  return null;
}

/** What the person did with the notice while they are on the record, kept per browser tab. */
export type AtWorkMemory = {
  /** When this screen first saw each work that says no start of its own, in milliseconds. */
  seen: Record<string, number>;
  /** The works the person chose not to wait for: the notice opens again only for another one. */
  dismissed: string[];
};

export const emptyMemory = (): AtWorkMemory => ({ seen: {}, dismissed: [] });

/** The memory read back from storage, whatever it holds: anything not of its shape is forgotten. */
export function memoryOf(raw: unknown): AtWorkMemory {
  if (!raw || typeof raw !== "object") return emptyMemory();
  const value = raw as Record<string, unknown>;
  const seen: Record<string, number> = {};
  if (value.seen && typeof value.seen === "object") {
    for (const [id, at] of Object.entries(value.seen as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) seen[id] = at;
    }
  }
  const dismissed = Array.isArray(value.dismissed)
    ? value.dismissed.filter((id): id is string => typeof id === "string")
    : [];
  return { seen, dismissed };
}

/**
 * The memory as the works stand now: each work keeps when it was first seen, a new one is seen now, and what ended
 * is forgotten, so a work that comes back later is a new one.
 */
export function rememberWork(memory: AtWorkMemory, items: readonly NowItem[], now: number): AtWorkMemory {
  const ids = new Set(items.map((item) => item.id));
  const seen: Record<string, number> = {};
  for (const item of items) seen[item.id] = memory.seen[item.id] ?? now;
  return { seen, dismissed: memory.dismissed.filter((id) => ids.has(id)) };
}

/** The person goes on without waiting for the works under way. */
export const dismissWork = (memory: AtWorkMemory, items: readonly NowItem[]): AtWorkMemory => ({
  ...memory,
  dismissed: [...new Set([...memory.dismissed, ...items.map((item) => item.id)])],
});

/** Whether the notice holds the screen: some work is under way that the person did not choose to go on without. */
export const holdsScreen = (memory: AtWorkMemory, items: readonly NowItem[]): boolean =>
  items.some((item) => !memory.dismissed.includes(item.id));

/** When a work started: when its record says, or else when this screen first saw it. */
export function startOf(item: NowItem, memory: AtWorkMemory, now: number): number {
  const said = item.since ? Date.parse(item.since) : Number.NaN;
  return Number.isFinite(said) ? Math.min(said, now) : (memory.seen[item.id] ?? now);
}

/**
 * Whether ONE is taking longer than usual: its oldest work under way started two minutes ago or more, and the
 * person did not just choose to wait more (`waitUntil`, two more minutes from their choice).
 */
export function isLong(
  items: readonly NowItem[],
  memory: AtWorkMemory,
  now: number,
  waitUntil: number | null = null,
): boolean {
  if (items.length === 0) return false;
  if (waitUntil !== null && now < waitUntil) return false;
  const started = Math.min(...items.map((item) => startOf(item, memory, now)));
  return now - started >= LONG_AFTER_MS;
}

/** How long something has lasted, in the words of the notice: seconds, minutes, or minutes and seconds. */
export function elapsedText(ms: number): { key: string; values: Record<string, number> } {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return { key: "one-at-work-seconds", values: { count: seconds } };
  if (seconds === 0) return { key: "one-at-work-minutes", values: { count: minutes } };
  return { key: "one-at-work-minutes-seconds", values: { minutes, seconds } };
}
