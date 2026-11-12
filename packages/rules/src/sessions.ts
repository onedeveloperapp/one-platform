import {
  businessDayBefore,
  computeDeadline,
  type CourtCalendar,
  type DeadlineCounting,
  type DeadlinePlace,
} from "@flyee/rules/deadlines";

/**
 * The session of judgment of an appeal and the registration for oral argument (`sustentacao-v1`, migration 0219;
 * `sustentacao-v2`, 0226).
 *
 * A panel judges an appeal in a session the court sets in its pauta: virtual (each judge votes in the system over
 * some days) or presencial (in person, by videoconference, or both). A lawyer who wants to argue registers first,
 * by the rule of the court and its body, which is data (`oral_argument_rules`):
 * - `previous_business_day`: until an hour of the court's business day before the session starts. The TJGO's
 *   Turmas Recursais: at 10h, in the system (Resolução nº 225/2023, art. 78, § 1º); the TJGO's chambers: at 10h, for
 *   a virtual session (Regimento Interno do TJGO, art. 150);
 * - `session_start`: until the session is declared open, for a presencial one (CPC, art. 937, § 2º; RITJGO, art. 150);
 * - `hours_before`: some hours before the session starts, or before its day starts (`anchor` `day`): the 48 hours of
 *   the CNJ's virtual sessions (Resolução CNJ nº 591/2024, arts. 8º, II, and 9º, as the TJSP, the TJRJ and the TJMG
 *   apply it), the 24 of a presencial session of the TJSP (Regimento Interno, art. 146, II) (`sustentacao-v2`);
 * - `days_after_publication`: some days counted from the publication of the pauta, as a term is (the turmas
 *   recursais of the TJMG: 5 business days, Código de Normas dos Juizados, art. 176, § 1º) (`sustentacao-v2`).
 *
 * Pure: the same session, rule and calendar give the same limit.
 */

export const ORAL_ARGUMENT_RULE_VERSION = "sustentacao-v2";

export const SESSION_KINDS = ["virtual", "presencial"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const ORAL_LIMITS = [
  "previous_business_day",
  "session_start",
  "hours_before",
  "days_after_publication",
] as const;
export type OralLimit = (typeof ORAL_LIMITS)[number];

/** A court's rule of registration, as `oral_argument_rules` holds it. */
export interface OralArgumentRule {
  until: OralLimit;
  /** The hour of the limit, "HH:MM", for `previous_business_day`; none otherwise. */
  hour: string | null;
  /** For `hours_before`: how many hours, and whether before the session's hour or before its day starts. */
  hours?: number | null;
  anchor?: "session" | "day" | null;
  /** For `days_after_publication`: how many days, counted as a term is. */
  days?: number | null;
  counting?: DeadlineCounting | null;
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
  /** The day the DJEN made the pauta available, for a rule counted from its publication. */
  publishedOn?: string | null;
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

export type OralArgumentFailure =
  | "invalid_day"
  | "invalid_hour"
  | "invalid_rule"
  | "no_business_day"
  | "no_publication"
  | "not_counted";
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
  if (rule.until === "hours_before") {
    const hours = rule.hours ?? 0;
    if (!Number.isInteger(hours) || hours < 1 || hours > 240) return { ok: false, code: "invalid_rule" };
    // From the session's hour; with none known, or anchored at the day, from the day's first minute: the earlier one.
    const from = rule.anchor === "day" || input.startsAt === null ? "00:00" : input.startsAt;
    const at = new Date(`${input.startsOn}T${from}:00Z`).getTime() - hours * 3_600_000;
    const moment = new Date(at).toISOString();
    return {
      ok: true,
      limit: {
        on: moment.slice(0, 10),
        hour: moment.slice(11, 16),
        basis: rule.basis,
        passed: [],
        ruleVersion: ORAL_ARGUMENT_RULE_VERSION,
      },
    };
  }
  if (rule.until === "days_after_publication") {
    if (!input.publishedOn || !DAY.test(input.publishedOn)) return { ok: false, code: "no_publication" };
    const counted = computeDeadline({
      trigger: "publication",
      on: input.publishedOn,
      days: rule.days ?? 0,
      counting: rule.counting ?? "business",
      place: input.place,
      calendar: input.calendar,
    });
    if (!counted.ok) return { ok: false, code: "not_counted" };
    return {
      ok: true,
      limit: {
        on: counted.result.dueOn,
        hour: null,
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
