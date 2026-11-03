import "server-only";

import { cookies, headers } from "next/headers";

import { REQUEST_PATH_HEADER } from "@/constants";
import { decideGate, type GateDecision, owesSecondFactor } from "@/lib/firm/gate-rules";
import type { MemberContext } from "@/lib/member/context";
import { partnerSetupOf } from "@/lib/modules/registry";
import { partnerSetupPending } from "@/lib/partners/partner";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the gate says of a request: where to send it instead (or null); whether
 * the person owes a second factor, which the shell reads to keep them on the
 * security screen on the pages they open after this one; and whether the
 * request is the client router's (a navigation, a refresh, a prefetch or a
 * server action) rather than a page the browser loads.
 *
 * On a request of the client router a redirect of the layout to one of its
 * own pages loops: the router keeps the layout as it drew it, redirect and
 * all, and every page under it throws the redirect again (seen on 2026-10-21,
 * a blank screen that kept asking for the security page). The layout leaves
 * those sends to the shell then (`shellHold`, lib/firm/gate-rules.ts).
 */
export type GateState = {
  decision: GateDecision;
  owesSecondFactor: boolean;
  clientRouter: boolean;
  /** Where the person's partner is set up (0080), or null; and whether who manages it never answered it. */
  partnerSetup: string | null;
  partnerSetupPending: boolean;
};

/** Reads what the gate needs from the request and the session, then decides. */
export async function resolveGate(context: MemberContext): Promise<GateState> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  const path = headerStore.get(REQUEST_PATH_HEADER) ?? "";
  // Next.js keeps its own headers of the client router (RSC, the router's state) from the pages and from the
  // middleware alike; what the browser says of the request stays. A page the browser loads is a navigation
  // (Sec-Fetch-Mode), or, from a client that does not say, asks for HTML; the router's requests and the server
  // actions are fetches.
  const fetchMode = headerStore.get("sec-fetch-mode");
  const clientRouter = fetchMode ? fetchMode !== "navigate" : !(headerStore.get("accept") ?? "").includes("text/html");
  const impersonating = cookieStore.has(IMPERSONATION_MARKER_COOKIE);

  let secondFactorRequired = false;
  let hasSecondFactor = true;
  if (!impersonating) {
    // `nextLevel` is aal2 when the session's account has a verified factor. The session's token says it: a
    // factor removed is seen once the token is refreshed, which the security card does right after removing.
    const { data: assurance } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    hasSecondFactor = assurance?.nextLevel === "aal2";
    if (!hasSecondFactor) {
      const { data: required } = await context.supabase.rpc("second_factor_required");
      secondFactorRequired = required === true;
    }
  }

  const partnerSetup = context.partner ? partnerSetupOf(context.partner.kind) : null;
  const pending = partnerSetupPending(context.partner);
  const input = {
    path,
    hasFirm: context.firm !== null,
    isPartner: context.partner !== null,
    partnerSetup,
    partnerSetupPending: pending,
    isSuperadmin: context.isSuperadmin,
    impersonating,
    secondFactorRequired,
    hasSecondFactor,
  };
  return {
    decision: decideGate(input),
    owesSecondFactor: owesSecondFactor(input),
    clientRouter,
    partnerSetup,
    partnerSetupPending: pending,
  };
}
