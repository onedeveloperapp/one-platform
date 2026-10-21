import "server-only";

import { cookies } from "next/headers";

import type { MemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the backend's half of an action asks of the session that started it.
 *
 * The half a person's own session runs is fenced by the database: its
 * functions refuse a support visit and ask for the second factor
 * (`begin_connection`, `disconnect_connection`, `reserve_wa_send`). But an
 * action also has a half the backend runs with its own client (opening a
 * token, calling the vendor, recording a simulated delivery), and nothing in
 * the database sees who asked for that. These are the same two questions,
 * asked before the backend does anything.
 */

/** A support visit reads the firm's screens and does nothing in the firm's name. */
export async function isSupportVisit(): Promise<boolean> {
  return (await cookies()).has(IMPERSONATION_MARKER_COOKIE);
}

/** Why the backend must not act on a firm's connection for this session, or null when it may. */
export async function connectionRefusal(context: MemberContext): Promise<string | null> {
  if (await isSupportVisit()) return "not_allowed_in_support_session";
  const { data } = await context.supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === "aal2" ? null : "second_factor_required";
}
