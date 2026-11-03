/**
 * Who may be in the logged area, as a pure decision: no request, no session,
 * no database. lib/firm/gate.ts reads what this needs and applies the answer.
 */

/** Where an account that belongs to no firm founds one or accepts an invitation. */
export const FIRM_SETUP_PATH = "/auth/complete-profile";

/**
 * Where somebody of a firm sets their factor up when the rule asks it of them: their own setup, whose first step
 * it is (the firm's for who manages it, the person's for anybody else; 2026-11-03), never a page of settings.
 */
export const OWN_SETUP_PATH = "/configurar";

/** Where a second factor is set up, with the note that it is required. */
export const SECOND_FACTOR_SETUP_PATH = "/settings/security";
export const SECOND_FACTOR_REQUIRED_URL = `${SECOND_FACTOR_SETUP_PATH}?exigido=1`;

/** What the platform operator, who works in no firm, may open in the logged area. */
const OPERATOR_PREFIXES = ["/admin", "/settings"];

/** Where somebody of a partner works (migration 0069), and their own account's settings. */
export const PARTNER_HOME = "/parceiro";
const PARTNER_PATHS = (path: string) =>
  path === PARTNER_HOME || path.startsWith(`${PARTNER_HOME}/`) || path === "/settings" || isSecondFactorSetupPath(path);

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
 *     else until it is done;
 *   * somebody of a partner of a firm (0069) is kept in the partner's area,
 *     and its own setup (0080) is where they set the factor up, its first
 *     step, told what it is for; who manages a partner that never answered
 *     its setup finds it in place of the partner's home. A partner sent to a
 *     page of settings with nothing of the partner's said got lost there
 *     (the owner, 2026-11-03).
 *
 * It is guidance, not the fence: the functions that change who has access ask
 * for the factor themselves, and row-level security never depends on this.
 * An unknown path (the header did not arrive) never causes the second-factor
 * redirect, so a missing header cannot loop.
 */
export function decideGate(input: {
  path: string;
  hasFirm: boolean;
  /** The person works in a partner of a firm (0069): never in a firm, never the platform's operator. */
  isPartner?: boolean;
  /** Where the person's partner is set up (0080, a page of its module, by the registry), or null. */
  partnerSetup?: string | null;
  /** Who manages the partner never answered its setup (0080): its home opens on the setup. */
  partnerSetupPending?: boolean;
  isSuperadmin: boolean;
  impersonating: boolean;
  secondFactorRequired: boolean;
  hasSecondFactor: boolean;
}): GateDecision {
  if (input.isPartner && !input.hasFirm) {
    // Somebody of a partner reaches its own area and their own account; nothing of a firm.
    if (input.path && !PARTNER_PATHS(input.path)) return { redirectTo: PARTNER_HOME };
    const setup = input.partnerSetup ?? null;
    if (setup) {
      // The partner's own setup opens on the second factor: its every write asks for it.
      if (owesSecondFactor(input)) {
        if (!input.path || input.path === setup || isSecondFactorSetupPath(input.path)) return null;
        return { redirectTo: setup };
      }
      if (input.partnerSetupPending && input.path === PARTNER_HOME) return { redirectTo: setup };
    }
  } else if (!input.hasFirm) {
    if (!input.isSuperadmin) return { redirectTo: FIRM_SETUP_PATH };
    if (input.path && !OPERATOR_PREFIXES.some((prefix) => input.path.startsWith(prefix))) {
      return { redirectTo: "/admin" };
    }
  }

  if (owesSecondFactor(input)) {
    if (!input.path || isSecondFactorSetupPath(input.path)) return null;
    if (input.hasFirm) return input.path === OWN_SETUP_PATH ? null : { redirectTo: OWN_SETUP_PATH };
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
  viewer: {
    hasFirm: boolean;
    partner?: boolean;
    partnerSetup?: string | null;
    partnerSetupPending?: boolean;
    isSuperadmin: boolean;
    owesSecondFactor: boolean;
  },
  path: string,
): string | null {
  const decision = decideGate({
    path,
    hasFirm: viewer.hasFirm,
    isPartner: viewer.partner === true,
    partnerSetup: viewer.partnerSetup ?? null,
    partnerSetupPending: viewer.partnerSetupPending === true,
    isSuperadmin: viewer.isSuperadmin,
    impersonating: false,
    secondFactorRequired: viewer.owesSecondFactor,
    hasSecondFactor: !viewer.owesSecondFactor,
  });
  return decision && decision.redirectTo !== FIRM_SETUP_PATH ? decision.redirectTo : null;
}
