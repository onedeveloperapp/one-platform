import { businessDayBefore, type CourtCalendar, type DeadlinePlace } from "@flyee/rules/deadlines";

/**
 * The session of judgment of an appeal and the registration for oral argument (`sustentacao-v1`, migration 0219).
 *
 * A panel judges an appeal in a session the court sets in its pauta: virtual (each judge votes in the system over
 * some days) or presencial (in person, by videoconference, or both). A lawyer who wants to argue registers first,
 * by the rule of the court and its body, which is data (`oral_argument_rules`):
 * - `previous_business_day`: until an hour of the court's business day before the session starts. The TJGO's
 *   Turmas Recursais: at 10h, in the system (Resolução nº 225/2023, art. 78, § 1º); the TJGO's chambers: at 10h, for
 *   a virtual session (Regimento Interno do TJGO, art. 150);
 * - `session_start`: until the session is declared open, for a presencial one (CPC, art. 937, § 2º; RITJGO, art. 150).
 *
 * Pure: the same session, rule and calendar give the same limit.
 */

export const ORAL_ARGUMENT_RULE_VERSION = "sustentacao-v1";

export const SESSION_KINDS = ["virtual", "presencial"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const ORAL_LIMITS = ["previous_business_day", "session_start"] as const;
export type OralLimit = (typeof ORAL_LIMITS)[number];

/** A court's rule of registration, as `oral_argument_rules` holds it. */
export interface OralArgumentRule {
  until: OralLimit;
  /** The hour of the limit, "HH:MM"; for `session_start`, none: the session's own hour. */
  hour: string | null;
  /** The act that says it, as the screen shows it. */
  basis: string;
}

export interface OralArgumentInput {
  /** The day the session starts. */
  startsOn: string;
  /** Its hour, "HH:MM", when the pauta says it. */
  startsAt: string | null;
  rule: OralArgumentRule;
  calendar: CourtCalendar;
  place: DeadlinePlace;
}

export interface OralArgumentLimit {
  /** The last day to register. */
  on: string;
  /** Until which hour of it; null when the session's hour is not known (`session_start`): until it opens. */
  hour: string | null;
  basis: string;
  /** The days passed back from the session that were no business days, with why. */
  passed: { day: string; label: string }[];
  ruleVersion: typeof ORAL_ARGUMENT_RULE_VERSION;
}

export type OralArgumentFailure = "invalid_day" | "invalid_hour" | "invalid_rule" | "no_business_day";
export type OralArgumentOutcome = { ok: true; limit: OralArgumentLimit } | { ok: false; code: OralArgumentFailure };

const HOUR = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Until when a lawyer registers to argue at a session. */
export function oralArgumentLimit(input: OralArgumentInput): OralArgumentOutcome {
  if (!DAY.test(input.startsOn)) return { ok: false, code: "invalid_day" };
  if (input.startsAt !== null && !HOUR.test(input.startsAt)) return { ok: false, code: "invalid_hour" };
  const { rule } = input;
  if (!(ORAL_LIMITS as readonly string[]).includes(rule.until)) return { ok: false, code: "invalid_rule" };
  if (rule.until === "session_start") {
    return {
      ok: true,
      limit: {
        on: input.startsOn,
        hour: input.startsAt,
        basis: rule.basis,
        passed: [],
        ruleVersion: ORAL_ARGUMENT_RULE_VERSION,
      },
    };
  }
  if (rule.hour === null || !HOUR.test(rule.hour)) return { ok: false, code: "invalid_rule" };
  const before = businessDayBefore(input.startsOn, input.calendar, input.place);
  if (!before) return { ok: false, code: "no_business_day" };
  return {
    ok: true,
    limit: {
      on: before.day,
      hour: rule.hour,
      basis: rule.basis,
      passed: before.passed,
      ruleVersion: ORAL_ARGUMENT_RULE_VERSION,
    },
  };
}
