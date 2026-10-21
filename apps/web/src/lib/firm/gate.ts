import "server-only";

import { cookies, headers } from "next/headers";

import { REQUEST_PATH_HEADER } from "@/constants";
import { decideGate, type GateDecision } from "@/lib/firm/gate-rules";
import type { MemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/** Reads what the gate needs from the request and the session, then decides. */
export async function resolveGate(context: MemberContext): Promise<GateDecision> {
  const [headerStore, cookieStore] = await Promise.all([headers(), cookies()]);
  const path = headerStore.get(REQUEST_PATH_HEADER) ?? "";
  const impersonating = cookieStore.has(IMPERSONATION_MARKER_COOKIE);

  let secondFactorRequired = false;
  let hasSecondFactor = true;
  if (!impersonating) {
    // `nextLevel` is aal2 exactly when the account has a verified factor.
    const { data: assurance } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    hasSecondFactor = assurance?.nextLevel === "aal2";
    if (!hasSecondFactor) {
      const { data: required } = await context.supabase.rpc("second_factor_required");
      secondFactorRequired = required === true;
    }
  }

  return decideGate({
    path,
    hasFirm: context.firm !== null,
    isSuperadmin: context.isSuperadmin,
    impersonating,
    secondFactorRequired,
    hasSecondFactor,
  });
}
