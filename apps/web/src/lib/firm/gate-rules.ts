/**
 * Who may be in the logged area, as a pure decision: no request, no session,
 * no database. lib/firm/gate.ts reads what this needs and applies the answer.
 */

/** Where an account that belongs to no firm founds one or accepts an invitation. */
export const FIRM_SETUP_PATH = "/auth/complete-profile";

/** Where a second factor is set up, with the note that it is required. */
export const SECOND_FACTOR_SETUP_PATH = "/settings/security";
export const SECOND_FACTOR_REQUIRED_URL = `${SECOND_FACTOR_SETUP_PATH}?exigido=1`;

/** What the platform operator, who works in no firm, may open in the logged area. */
const OPERATOR_PREFIXES = ["/admin", "/settings"];

export type GateDecision = { redirectTo: string } | null;

/**
 * Pure: where a request to the logged area is sent instead of the page it
 * asked for, or null to let it through.
 *
 *   * an account with no firm goes to found one or accept an invitation; the
 *     platform operator, who has none on purpose, keeps the consoles and the
 *     own-account settings;
 *   * a person the rule asks a second factor of (second_factor_required(),
 *     migration 0003) and who has none goes to set it up, and reaches nothing
 *     else until it is done.
 *
 * It is guidance, not the fence: the functions that change who has access ask
 * for the factor themselves, and row-level security never depends on this.
 * An unknown path (the header did not arrive) never causes the second-factor
 * redirect, so a missing header cannot loop.
 */
export function decideGate(input: {
  path: string;
  hasFirm: boolean;
  isSuperadmin: boolean;
  impersonating: boolean;
  secondFactorRequired: boolean;
  hasSecondFactor: boolean;
}): GateDecision {
  if (!input.hasFirm) {
    if (!input.isSuperadmin) return { redirectTo: FIRM_SETUP_PATH };
    if (input.path && !OPERATOR_PREFIXES.some((prefix) => input.path.startsWith(prefix))) {
      return { redirectTo: "/admin" };
    }
  }

  // A support visit is the operator's session standing in for the person: the
  // operator cannot set up somebody else's factor, and already passed their own.
  if (input.impersonating) return null;

  if (input.secondFactorRequired && !input.hasSecondFactor) {
    if (!input.path || input.path.startsWith(SECOND_FACTOR_SETUP_PATH)) return null;
    return { redirectTo: SECOND_FACTOR_REQUIRED_URL };
  }
  return null;
}
