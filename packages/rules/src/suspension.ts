/**
 * The triage of a case against the national suspension of Tema 1.417 of the
 * STF (ARE 1.560.244): the lawsuits on an airline's civil liability for a
 * cancelled, changed or delayed flight are suspended while the Court decides
 * whether the Código Brasileiro de Aeronáutica or the consumer code governs
 * it. The rapporteur made clear, in the embargos de declaração, that the
 * suspension reaches only the cases of caso fortuito or força maior of the
 * CBA, art. 256, §3 (wording of Lei 14.034/2020): restrictions on landing or
 * take-off for adverse weather (I) or unavailable airport infrastructure
 * (II), restrictions ordered by the aviation or another public authority
 * (III), and a pandemic and the acts it led to (IV). A cause internal to the
 * airline (its maintenance, its crew, its network, its sales) is, in
 * principle, outside it. Read on 2026-10-09 from the courts' orientation
 * notes; the Court's decision on the merits had not come.
 *
 * What this gives is a RISK for the firm to weigh, never a decision: whether
 * a lawsuit is suspended is the court's. It reads what the airline told the
 * passenger (their questionnaire) and the weather signs observed at the
 * airports of the trip (`weather.ts`), and names the grounds it used.
 */

export const SUSPENSION_RULE_VERSION = "tema-1417-v1";

/** What the airline said was the cause, as the passenger reports it. */
export type StatedCause =
  | "weather"
  | "airport_infrastructure"
  | "authority"
  | "pandemic"
  | "maintenance"
  | "crew"
  | "network"
  | "overbooking"
  | "none_given"
  | "other";

export const STATED_CAUSES: readonly StatedCause[] = [
  "weather",
  "airport_infrastructure",
  "authority",
  "pandemic",
  "maintenance",
  "crew",
  "network",
  "overbooking",
  "none_given",
  "other",
];

export type SuspensionRisk = "high" | "medium" | "low" | "out_of_scope" | "unknown";

/**
 * - `incident_out_of_scope`: not a cancelled, changed or delayed flight (baggage, a downgrade);
 * - `alleged_weather` / `alleged_infrastructure` / `alleged_authority` / `alleged_pandemic`: a cause of art. 256, §3;
 * - `weather_observed` / `weather_not_observed`: what the reports of the airports of the trip showed;
 * - `internal_cause`: a cause of the airline itself (maintenance, crew, network, overbooking);
 * - `no_cause_given`: the airline gave none, or another;
 * - `cause_not_recorded`: nobody wrote down yet what the airline said;
 * - `incident_unclear`: the incident is recorded as "other", which may or may not be a changed flight;
 * - `weather_not_assessed`: the reports were not read, or not for every airport of the leg.
 */
export type SuspensionGround =
  | "incident_out_of_scope"
  | "alleged_weather"
  | "alleged_infrastructure"
  | "alleged_authority"
  | "alleged_pandemic"
  | "weather_observed"
  | "weather_not_observed"
  | "internal_cause"
  | "no_cause_given"
  | "cause_not_recorded"
  | "incident_unclear"
  | "weather_not_assessed";

export type SuspensionInput = {
  /** The case's incident (`delay`, `cancellation`, ...). */
  incident: string;
  statedCause: StatedCause | null;
  /** The signs found in the reports of the airports of the trip, or null when they were not read. */
  weatherSigns: string[] | null;
};

export type SuspensionTriage = {
  risk: SuspensionRisk;
  grounds: SuspensionGround[];
  rule: typeof SUSPENSION_RULE_VERSION;
};

/** The incidents the suspension speaks of: a flight cancelled, changed or delayed. */
const IN_SCOPE = new Set(["delay", "cancellation", "missed_connection"]);
/** The incidents that are, by their nature, the airline's own doing. */
const INTERNAL_INCIDENTS = new Set(["overbooking"]);

const ALLEGED: Partial<Record<StatedCause, SuspensionGround>> = {
  weather: "alleged_weather",
  airport_infrastructure: "alleged_infrastructure",
  authority: "alleged_authority",
  pandemic: "alleged_pandemic",
};

const INTERNAL: readonly StatedCause[] = ["maintenance", "crew", "network", "overbooking"];

export function triageSuspension(input: SuspensionInput): SuspensionTriage {
  const rule = SUSPENSION_RULE_VERSION;
  if (INTERNAL_INCIDENTS.has(input.incident)) return { risk: "low", grounds: ["internal_cause"], rule };
  // "Other" is where a changed schedule lands when nothing fits better: nothing is asserted of it.
  if (input.incident === "other") return { risk: "unknown", grounds: ["incident_unclear"], rule };
  if (!IN_SCOPE.has(input.incident)) return { risk: "out_of_scope", grounds: ["incident_out_of_scope"], rule };

  const observed =
    input.weatherSigns === null ? "weather_not_assessed" : input.weatherSigns.length > 0 ? "weather_observed" : "weather_not_observed";
  const alleged = input.statedCause ? ALLEGED[input.statedCause] : undefined;

  if (alleged === "alleged_weather") {
    // The airline will say what it told the passenger; the reports say whether the sky agrees.
    return {
      risk: observed === "weather_not_observed" ? "medium" : "high",
      grounds: [alleged, observed],
      rule,
    };
  }
  if (alleged) return { risk: "high", grounds: [alleged], rule };
  if (input.statedCause && INTERNAL.includes(input.statedCause)) {
    // An internal cause, but weather on the day gives the airline something to allege.
    return observed === "weather_observed"
      ? { risk: "medium", grounds: ["internal_cause", observed], rule }
      : { risk: "low", grounds: ["internal_cause"], rule };
  }
  // What the airline said was never written down: weather on the day is still a reason to look, and
  // nothing else can be said.
  if (input.statedCause === null) {
    return observed === "weather_observed"
      ? { risk: "medium", grounds: ["cause_not_recorded", observed], rule }
      : { risk: "unknown", grounds: ["cause_not_recorded", observed], rule };
  }
  // No cause given (or another): what the reports show is all there is.
  if (observed === "weather_observed") return { risk: "medium", grounds: ["no_cause_given", observed], rule };
  if (observed === "weather_not_observed") return { risk: "low", grounds: ["no_cause_given", observed], rule };
  return { risk: "unknown", grounds: ["no_cause_given", observed], rule };
}
