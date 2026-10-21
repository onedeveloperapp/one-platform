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

  if (owesSecondFactor(input)) {
    if (!input.path || isSecondFactorSetupPath(input.path)) return null;
    return { redirectTo: SECOND_FACTOR_REQUIRED_URL };
  }
  return null;
}

/**
 * Pure: the person owes the second factor the rule asks of them, and has none.
 * A support visit owes nothing: it is the operator's session standing in for
 * the person, and the operator cannot set up somebody else's factor and
 * already passed their own.
 *
 * Such a person is kept on the security screen: on the first page they open
 * by the layout's redirect, and on every page they open after it by the shell
 * (components/layout/dashboard-shell.tsx), since a layout is not drawn again
 * while somebody moves between its pages.
 */
export function owesSecondFactor(input: {
  impersonating: boolean;
  secondFactorRequired: boolean;
  hasSecondFactor: boolean;
}): boolean {
  return !input.impersonating && input.secondFactorRequired && !input.hasSecondFactor;
}

/** Pure: the page where a second factor is set up, the one page open to who owes it. */
export function isSecondFactorSetupPath(path: string): boolean {
  return path === SECOND_FACTOR_SETUP_PATH || path.startsWith(`${SECOND_FACTOR_SETUP_PATH}/`);
}

/**
 * Pure: where the shell of the logged area keeps a person instead of the page at `path`, or null. It is the
 * gate's own answer for the sends that stay inside the logged area: the platform operator outside the
 * consoles, and who owes a second factor outside the security screen. An account with no firm is sent out of
 * the logged area by the layout itself, so the shell never holds it.
 *
 * The shell asks it of every page somebody opens, since the layout above is drawn once; and the layout leaves
 * these sends to the shell on a request of the client router, where a redirect of its own would loop
 * (lib/firm/gate.ts).
 */
export function shellHold(
  viewer: { hasFirm: boolean; isSuperadmin: boolean; owesSecondFactor: boolean },
  path: string,
): string | null {
  const decision = decideGate({
    path,
    hasFirm: viewer.hasFirm,
    isSuperadmin: viewer.isSuperadmin,
    impersonating: false,
    secondFactorRequired: viewer.owesSecondFactor,
    hasSecondFactor: !viewer.owesSecondFactor,
  });
  return decision && decision.redirectTo !== FIRM_SETUP_PATH ? decision.redirectTo : null;
}
