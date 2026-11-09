import type { OneWorkKind } from "@/lib/one-work/work";

/**
 * The firm's estimates of ONE's work (migrations 0120 and 0121), as "Ajustar estimativas" edits them. Pure: what is sent to the
 * database (only what changed: a kind's minutes, or ONE's back, and the cost of an hour), and the words of a refusal.
 */

/** The most minutes a task is taken to take, as the database checks it. */
export const MAX_MINUTES = 600;
/** The most an hour may cost, in centavos (R$ 100.000), as the database checks it. */
export const MAX_HOUR_CENTS = 10_000_000;

export type EstimatesInput = {
  /** The minutes of each kind that changed; null goes back to ONE's. */
  minutes: Record<string, number | null>;
  /** Whether the cost of an hour changed, and what it is now (null: none said). */
  setCost: boolean;
  hourCents: number | null;
};

export type EstimatesRead = ({ ok: true } & EstimatesInput) | { ok: false; code: "minutes" | "cost" | "kind" };

const KIND = /^[a-z][a-z0-9_]{2,40}$/;

/** What a request to save the estimates carries, checked before the database checks it again. */
export function estimatesInputOf(input: unknown): EstimatesRead {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const raw = (typeof value.minutes === "object" && value.minutes !== null ? value.minutes : {}) as Record<
    string,
    unknown
  >;
  const minutes: Record<string, number | null> = {};
  for (const [kind, entry] of Object.entries(raw)) {
    if (!KIND.test(kind)) return { ok: false, code: "kind" };
    if (entry === null) {
      minutes[kind] = null;
      continue;
    }
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > MAX_MINUTES) {
      return { ok: false, code: "minutes" };
    }
    minutes[kind] = entry;
  }
  const setCost = value.setCost === true;
  const cents = value.hourCents;
  if (
    setCost &&
    cents !== null &&
    (typeof cents !== "number" || !Number.isInteger(cents) || cents < 1 || cents > MAX_HOUR_CENTS)
  ) {
    return { ok: false, code: "cost" };
  }
  return { ok: true, minutes, setCost, hourCents: setCost ? ((cents as number | null) ?? null) : null };
}

/** What the person typed for a kind: the minutes, or blank (ONE's again). */
export type MinutesDraft = Record<string, string>;

/** The form as it opens: each kind with the minutes in force, blank where the firm follows ONE's. */
export function minutesDraftOf(kinds: OneWorkKind[]): MinutesDraft {
  return Object.fromEntries(
    kinds.map((kind) => [kind.key, kind.own && kind.minutes !== null ? String(kind.minutes) : ""]),
  );
}

/** A typed number of minutes; null for blank (ONE's), undefined for what is no number of minutes. */
export function typedMinutes(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value <= MAX_MINUTES ? value : undefined;
}

/**
 * What changed of the minutes since the form opened: a kind the firm had set and now left blank goes back to ONE's;
 * one typed as ONE's own number while following ONE's stays as it was. Undefined when a field holds no number.
 */
export function changedMinutes(kinds: OneWorkKind[], draft: MinutesDraft): Record<string, number | null> | undefined {
  const changed: Record<string, number | null> = {};
  for (const kind of kinds) {
    const typed = typedMinutes(draft[kind.key] ?? "");
    if (typed === undefined) return undefined;
    if (typed === null) {
      if (kind.own) changed[kind.key] = null;
    } else if (!kind.own ? typed !== kind.defaultMinutes : typed !== kind.minutes) {
      changed[kind.key] = typed;
    }
  }
  return changed;
}

/**
 * The cost of an hour the money field reports (its amount as a plain number, "150.5"), in centavos; null for blank,
 * undefined for an amount the database would refuse.
 */
export function typedHourCents(amount: string): number | null | undefined {
  const trimmed = amount.trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  const cents = Math.round(Number(trimmed) * 100);
  return cents >= 1 && cents <= MAX_HOUR_CENTS ? cents : undefined;
}

/** A cost of an hour as the money field takes it: "150" or "150.5". */
export function hourCentsText(cents: number | null): string {
  if (cents === null) return "";
  return String(cents / 100);
}

const ERROR_KEY: Record<string, string> = {
  not_allowed: "one-work-error-not-allowed",
  support_visit: "one-work-error-support",
  minutes: "one-work-error-minutes",
  cost: "one-work-error-cost",
  kind: "one-work-error-failed",
};

export const estimatesErrorKey = (code: string): string => ERROR_KEY[code] ?? "one-work-error-failed";
