/**
 * Whether a passenger's problem qualifies (`qualificacao-v2`, the owner's
 * decisions of 2026-11-07, 2026-11-10 and 2026-11-13): ONE decides it alone,
 * before a case is opened, and always says why.
 *
 *   - A cancellation qualifies, unless the airline told of it 72 hours or
 *     more before the flight and none of the exceptions happened (Resolução
 *     ANAC nº 400/2016, art. 12), or the passenger arrived less than 4 hours
 *     after the time scheduled (v2). A passenger who did not travel after it
 *     is decided by the notice alone.
 *   - A scheduled change qualifies when told less than 72 hours before and
 *     the passenger arrived 4 hours or more after the time scheduled (v2);
 *     with no arrival known, when it moved the flight more than 30 minutes (a
 *     domestic flight) or one hour (an international one), art. 12, § 1º, II;
 *     told 72 hours or more before, only with an exception.
 *   - A delay, and a connection lost, qualify when the passenger arrived 4
 *     hours or more after the time scheduled: the same number the flight's
 *     alert tells at.
 *   - Boarding denied (overbooking) always qualifies, and so does a bag lost,
 *     damaged or delivered late.
 *   - The exceptions are the owner's five: no alternatives offered, the
 *     refund denied or late, a credit imposed, a trip to the airport made by a
 *     failure to inform, a loss proven.
 *   - The weather the airline alleges does not stop it: the case then follows
 *     the decision of the Tema 1.417 (`suspension`).
 *   - Prescription: 5 years for a domestic flight (CDC, art. 27); for an
 *     international one, 2 years for the material damage (Convenção de
 *     Montreal, art. 35; STF, Tema 210) and 5 for the moral one (STF, Tema
 *     1.240).
 *
 * It answers `qualifies` or `not_qualified`, or, where it cannot decide,
 * `pending` (a fact it needs is missing, and which) or `review` (a problem
 * outside the table: a person decides). What it could not know and assumed
 * is said beside the answer. Pure: no clock of its own, the day is given.
 */

import { readDay } from "@flyee/rules/person";

export const QUALIFICATION_RULE = "qualificacao-v2";

/** How late the arrival is for a delay to qualify: the alert's own number (`flight-problem`). */
export const QUALIFYING_DELAY_MINUTES = 240;
/** How far a change told late must move the flight (art. 12, § 1º, II). */
export const CHANGE_LIMIT_MINUTES = { domestic: 30, international: 60 } as const;

export const QUALIFICATION_PROBLEMS = [
  "cancellation",
  "change",
  "delay",
  "missed_connection",
  "overbooking",
  "baggage_lost",
  "baggage_damaged",
  "baggage_delayed",
  "downgrade",
  "other",
] as const;
export type QualificationProblem = (typeof QUALIFICATION_PROBLEMS)[number];
export const isQualificationProblem = (value: unknown): value is QualificationProblem =>
  (QUALIFICATION_PROBLEMS as readonly unknown[]).includes(value);

export const QUALIFICATION_EXCEPTIONS = [
  "no_alternatives",
  "refund_denied_or_late",
  "credit_imposed",
  "airport_misinformed",
  "proven_loss",
] as const;
export type QualificationException = (typeof QUALIFICATION_EXCEPTIONS)[number];

/** When the airline told of a cancellation or a change: at the airport, under 72 hours before, 72 or more. */
export type NoticeStanding = "at_airport" | "late" | "early";

export type QualificationInput = {
  problem: QualificationProblem;
  /** The scheduled departure day of the flight the problem was in. */
  flightDay: string | null;
  /** Today, in the day of Brasília. */
  today: string;
  /** Whether the flight was international (a leg abroad); null when not known. */
  international: boolean | null;
  /**
   * How late the passenger arrived at the end of the journey: for a delay or a lost connection, and, since v2, for a
   * cancellation or a change the passenger travelled after.
   */
  arrivalDelayMinutes?: number | null;
  /** For a cancellation or a change: false when the passenger did not travel after it (v2); null when not known. */
  travelled?: boolean | null;
  /** For a change: how far the flight was moved. */
  changeMinutes?: number | null;
  /** For a cancellation or a change: when the airline told of it (`noticeStanding` of the interview). */
  notice?: NoticeStanding | null;
  /** What of the exceptions is known to have happened. */
  exceptions?: readonly QualificationException[];
};

export type QualificationOutcome = "qualifies" | "not_qualified" | "pending" | "review";

export type QualificationReason =
  | "cancelled"
  | "cancelled_with_exception"
  | "cancelled_early_notice"
  | "changed"
  | "changed_with_exception"
  | "changed_small"
  | "changed_early_notice"
  | "delayed"
  | "delay_short"
  | "overbooking"
  | "baggage"
  | "outside_rule"
  | "prescribed"
  | "material_prescribed";

/** What the rule needs and does not have. */
export type QualificationMissing = "flight_day" | "arrival" | "change";

/** What the rule assumed of what it could not know: it never makes a problem qualify by an assumption it hides. */
export type QualificationAssumption = "notice_unknown" | "international_unknown";

export type QualificationResult = {
  rule: typeof QUALIFICATION_RULE;
  outcome: QualificationOutcome;
  reasons: QualificationReason[];
  missing: QualificationMissing[];
  assumptions: QualificationAssumption[];
  /** What the passenger may still ask for: the material damage is lost first, for an international flight. */
  claims: { material: boolean; moral: boolean };
};

/** The day `years` years after a day (29 February goes to 28 February in a year that has none). */
function yearsAfter(day: string, years: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const year = y + years;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Whether a claim of `years` years from the flight's day is still on `today` (the last day included). */
const inTime = (flightDay: string, years: number, today: string): boolean => today <= yearsAfter(flightDay, years);

export function qualify(input: QualificationInput): QualificationResult {
  const result = (
    outcome: QualificationOutcome,
    reasons: QualificationReason[],
    extra: Partial<Pick<QualificationResult, "missing" | "assumptions" | "claims">> = {},
  ): QualificationResult => ({
    rule: QUALIFICATION_RULE,
    outcome,
    reasons,
    missing: extra.missing ?? [],
    assumptions: extra.assumptions ?? [],
    claims: extra.claims ?? { material: true, moral: true },
  });

  const flightDay = input.flightDay && readDay(input.flightDay) ? input.flightDay : null;
  const today = readDay(input.today) ? input.today : null;
  const assumptions: QualificationAssumption[] = [];
  const claims = { material: true, moral: true };
  const prescription: QualificationReason[] = [];

  if (!flightDay || !today) return result("pending", [], { missing: ["flight_day"] });
  // Prescription first: a problem out of time qualifies for nothing, whatever it was.
  if (!inTime(flightDay, 5, today))
    return result("not_qualified", ["prescribed"], { claims: { material: false, moral: false } });
  if (!inTime(flightDay, 2, today)) {
    if (input.international === true) {
      claims.material = false;
      prescription.push("material_prescribed");
    } else if (input.international === null) {
      assumptions.push("international_unknown");
    }
  }

  const exceptions = input.exceptions ?? [];
  const notice = input.notice ?? null;
  const done = (outcome: QualificationOutcome, reason: QualificationReason, missing: QualificationMissing[] = []) =>
    result(outcome, [reason, ...prescription], { missing, assumptions, claims });

  switch (input.problem) {
    case "cancellation": {
      if (notice === "early") {
        return exceptions.length > 0
          ? done("qualifies", "cancelled_with_exception")
          : done("not_qualified", "cancelled_early_notice");
      }
      if (notice === null) assumptions.push("notice_unknown");
      // Who travelled after it and arrived less than 4 hours late has no claim (v2); who did not travel, the notice decides.
      const late = input.travelled === false ? null : input.arrivalDelayMinutes;
      if (late !== null && late !== undefined && Number.isFinite(late) && late < QUALIFYING_DELAY_MINUTES) {
        return done("not_qualified", "delay_short");
      }
      return done("qualifies", "cancelled");
    }
    case "change": {
      if (notice === "early") {
        return exceptions.length > 0
          ? done("qualifies", "changed_with_exception")
          : done("not_qualified", "changed_early_notice");
      }
      // The arrival decides a change the passenger travelled after (v2), and the notice one they did not travel after.
      const late = input.travelled === false ? null : input.arrivalDelayMinutes;
      if (late !== null && late !== undefined && Number.isFinite(late)) {
        if (notice === null) assumptions.push("notice_unknown");
        return late >= QUALIFYING_DELAY_MINUTES ? done("qualifies", "changed") : done("not_qualified", "delay_short");
      }
      if (input.travelled === false) {
        if (notice === null) assumptions.push("notice_unknown");
        return done("qualifies", "changed");
      }
      const moved = input.changeMinutes;
      if (moved === null || moved === undefined || !Number.isFinite(moved))
        return done("pending", "changed", ["change"]);
      if (input.international === null && !assumptions.includes("international_unknown")) {
        assumptions.push("international_unknown");
      }
      // An unknown flight is held to the domestic limit, the smaller: a change above it qualifies a domestic flight.
      const limit = input.international === true ? CHANGE_LIMIT_MINUTES.international : CHANGE_LIMIT_MINUTES.domestic;
      if (notice === null) assumptions.push("notice_unknown");
      // Told late, only a change above the limit qualifies (the owner, 2026-11-07); the exceptions are of the 72 hours.
      return Math.abs(moved) > limit ? done("qualifies", "changed") : done("not_qualified", "changed_small");
    }
    case "delay":
    case "missed_connection": {
      const late = input.arrivalDelayMinutes;
      if (late === null || late === undefined || !Number.isFinite(late)) return done("pending", "delayed", ["arrival"]);
      return late >= QUALIFYING_DELAY_MINUTES ? done("qualifies", "delayed") : done("not_qualified", "delay_short");
    }
    case "overbooking":
      return done("qualifies", "overbooking");
    case "baggage_lost":
    case "baggage_damaged":
    case "baggage_delayed":
      return done("qualifies", "baggage");
    default:
      return done("review", "outside_rule");
  }
}

/** The problem a case's kind of incident is, for the rule. */
export function problemOfIncident(incident: string): QualificationProblem {
  return isQualificationProblem(incident) ? incident : "other";
}

/** The problem ONE told the passenger of, for the rule. */
export function problemOfAlert(kind: "cancelled" | "changed" | "delayed"): QualificationProblem {
  return kind === "cancelled" ? "cancellation" : kind === "changed" ? "change" : "delay";
}
