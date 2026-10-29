/**
 * The words of the check of a leg (migration 0030), by code: what an action
 * answered, and where a check stands. Pure: a test reads that every code has
 * its words in the catalog.
 */

/** What an action of the check answered, by the code the database or the server gave; anything else is "failed". */
const ERROR_KEY: Record<string, string> = {
  lookup_not_configured: "flight-error-not-configured",
  lookup_key_refused: "flight-error-key-refused",
  lookup_refused: "flight-error-refused",
  lookup_unavailable: "flight-error-unavailable",
  daily_limit: "flight-error-daily-limit",
  lookup_cooldown: "flight-error-cooldown",
  flight_incomplete: "flight-error-incomplete",
  flight_changed: "flight-error-changed",
  nothing_to_recheck: "flight-error-nothing-to-recheck",
  segment_not_found: "flight-error-not-found",
  case_not_found: "flight-error-not-found",
  not_allowed_in_support_session: "flight-error-support",
  backend_not_configured: "flight-error-not-configured",
};
export const flightErrorKey = (code: string): string => ERROR_KEY[code] ?? "flight-error-failed";

/** Why a check of the record was given up, by the code the backend left; anything else in general words. */
const RECORD_FAILURE_KEY: Record<string, string> = {
  vra_month_missing: "flight-record-month-missing",
};
export const recordFailureKey = (code: string | null): string =>
  (code ? RECORD_FAILURE_KEY[code] : undefined) ?? "flight-record-failed";

/** Why FlightAware's last answer is not there: a lookup that never came back, or one that failed. */
const LOOKUP_FAILURE_KEY: Record<string, string> = {
  lookup_lost: "flight-fa-lost",
  lookup_key_refused: "flight-error-key-refused",
  lookup_refused: "flight-error-refused",
};
export const lookupFailureKey = (code: string | null): string =>
  (code ? LOOKUP_FAILURE_KEY[code] : undefined) ?? "flight-fa-failed";

/** The codes the database answers a person with (migration 0030), each of which has words. */
export const FLIGHT_REFUSALS: readonly string[] = [
  "segment_not_found",
  "flight_incomplete",
  "nothing_to_recheck",
  "daily_limit",
  "lookup_cooldown",
];
