import { minutesBetween } from "@flyee/rules/flight-problem";
import { type InterviewAnswer, type InterviewFacts, noticeStanding } from "@flyee/rules/interview";
import {
  problemOfAlert,
  problemOfIncident,
  type QualificationException,
  type QualificationOutcome,
  type QualificationReason,
  type QualificationResult,
  qualify,
} from "@flyee/rules/qualification";

/**
 * Whether a case's problem qualifies (migration 0147): what the rule
 * `qualificacao-v1` reads of a case (`case_qualification_facts`), turned into
 * its input, and the words the screens say of its answer. Pure.
 */

const MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const momentOf = (value: unknown): string | null => (typeof value === "string" && MOMENT.test(value) ? value : null);

type AlertKind = "cancelled" | "changed" | "delayed";
const isAlertKind = (value: unknown): value is AlertKind =>
  value === "cancelled" || value === "changed" || value === "delayed";

/** How late the passenger arrived: ONE's own word on the flight, a source's arrival, or the passenger's own. */
function arrivalDelayOf(
  alert: { kind: AlertKind; delayMinutes: number | null } | null,
  scheduledArrival: string | null,
  actualArrival: string | null,
  told: string | null,
): number | null {
  if (alert?.kind === "delayed" && alert.delayMinutes !== null) return alert.delayMinutes;
  if (!scheduledArrival) return null;
  for (const arrival of [actualArrival, told]) {
    // An arrival the passenger gave as a day alone says nothing of hours.
    if (arrival && arrival.length > 10) {
      const late = minutesBetween(scheduledArrival, arrival);
      if (late !== null) return late;
    }
  }
  return null;
}

/** The rule's answer for a case, from what `case_qualification_facts` read of it; null for what is not a reading. */
export function caseQualification(raw: unknown, today: string): QualificationResult | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const facts = raw as Record<string, unknown>;
  if (typeof facts.incident !== "string" || !DAY.test(today)) return null;
  const alertRaw = facts.alert && typeof facts.alert === "object" ? (facts.alert as Record<string, unknown>) : null;
  const alert =
    alertRaw && isAlertKind(alertRaw.kind)
      ? {
          kind: alertRaw.kind,
          delayMinutes: typeof alertRaw.delay_minutes === "number" ? alertRaw.delay_minutes : null,
        }
      : null;
  const raws =
    facts.answers && typeof facts.answers === "object"
      ? (facts.answers as Record<string, Record<string, unknown>>)
      : {};
  const answers: InterviewFacts["answers"] = {};
  for (const question of ["aviso_local", "aviso_quando", "chegada"] as const) {
    const item = raws[question];
    if (!item) continue;
    const status =
      item.status === "answered" || item.status === "unknown" || item.status === "skipped" ? item.status : null;
    if (!status) continue;
    const answer: InterviewAnswer = {
      status,
      yesNo: item.sim_nao === "sim" ? true : item.sim_nao === "nao" ? false : null,
      moment: momentOf(item.quando),
    };
    answers[question] = answer;
  }
  const scheduledDeparture = momentOf(facts.scheduled_departure);
  const scheduledArrival = momentOf(facts.scheduled_arrival);
  const notice = noticeStanding({
    incident: facts.incident,
    alert,
    airlineCause: null,
    scheduledDeparture,
    scheduledArrival,
    actualArrival: momentOf(facts.actual_arrival),
    companionsKnown: false,
    answers,
  });
  // A trip to the airport the airline did not warn of is one of the exceptions the owner named.
  const exceptions: QualificationException[] = answers.aviso_local?.yesNo === true ? ["airport_misinformed"] : [];
  const flightDay = typeof facts.flight_date === "string" && DAY.test(facts.flight_date) ? facts.flight_date : null;
  return qualify({
    problem: alert ? problemOfAlert(alert.kind) : problemOfIncident(facts.incident),
    flightDay,
    today,
    international: typeof facts.international === "boolean" ? facts.international : null,
    arrivalDelayMinutes: arrivalDelayOf(
      alert,
      scheduledArrival,
      momentOf(facts.actual_arrival),
      answers.chegada?.moment ?? null,
    ),
    changeMinutes: alert?.kind === "changed" ? alert.delayMinutes : null,
    notice,
    exceptions,
  });
}

/**
 * The rule's answer for ONE's word about a flight (0147), at the passenger's yes: the problem it told, its size where
 * the alert keeps one, the flight's day and whether a leg was abroad. When the airline told of it is not known yet.
 */
export function alertQualification(input: {
  kind: string;
  delayMinutes: number | null;
  flightDay: string | null;
  international: boolean | null;
  today: string;
}): QualificationResult | null {
  if (!isAlertKind(input.kind)) return null;
  return qualify({
    problem: problemOfAlert(input.kind),
    flightDay: input.flightDay,
    today: input.today,
    international: input.international,
    arrivalDelayMinutes: input.kind === "delayed" ? input.delayMinutes : null,
    changeMinutes: input.kind === "changed" ? input.delayMinutes : null,
    notice: null,
  });
}

/** What the database keeps of the rule's word on a case, read back for a screen. */
export type CaseQualification = {
  outcome: QualificationOutcome;
  reasons: QualificationReason[];
  missing: string[];
  released: { by: string | null; at: string; reason: string } | null;
};

const OUTCOMES: readonly QualificationOutcome[] = ["qualifies", "not_qualified", "pending", "review"];

export function readCaseQualification(
  value: unknown,
  release: { by: string | null; at: string | null; reason: string | null },
): CaseQualification | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!(OUTCOMES as readonly unknown[]).includes(item.outcome)) return null;
  const list = (field: unknown): string[] =>
    Array.isArray(field) ? field.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    outcome: item.outcome as QualificationOutcome,
    reasons: list(item.reasons).filter((reason): reason is QualificationReason => reason in REASON_KEY),
    missing: list(item.missing),
    released: release.at && release.reason ? { by: release.by, at: release.at, reason: release.reason } : null,
  };
}

/** Whether ONE holds the case's lawsuits for the rule: a problem that does not qualify, nobody having gone on. */
export const qualificationHolds = (qualification: { outcome: string; released: boolean } | null): boolean =>
  qualification?.outcome === "not_qualified" && !qualification.released;

export const OUTCOME_KEY: Record<QualificationOutcome, string> = {
  qualifies: "qualification-outcome-qualifies",
  not_qualified: "qualification-outcome-not-qualified",
  pending: "qualification-outcome-pending",
  review: "qualification-outcome-review",
};

export const REASON_KEY: Record<QualificationReason, string> = {
  cancelled: "qualification-reason-cancelled",
  cancelled_with_exception: "qualification-reason-cancelled-with-exception",
  cancelled_early_notice: "qualification-reason-cancelled-early-notice",
  changed: "qualification-reason-changed",
  changed_with_exception: "qualification-reason-changed-with-exception",
  changed_small: "qualification-reason-changed-small",
  changed_early_notice: "qualification-reason-changed-early-notice",
  delayed: "qualification-reason-delayed",
  delay_short: "qualification-reason-delay-short",
  overbooking: "qualification-reason-overbooking",
  baggage: "qualification-reason-baggage",
  outside_rule: "qualification-reason-outside-rule",
  prescribed: "qualification-reason-prescribed",
  material_prescribed: "qualification-reason-material-prescribed",
};

export const MISSING_KEY: Record<string, string> = {
  flight_day: "qualification-missing-flight-day",
  arrival: "qualification-missing-arrival",
  change: "qualification-missing-change",
};
