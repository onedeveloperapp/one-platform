import "server-only";

import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is operating an admin console.
 *
 * The `/admin` layout already refuses anybody who is not a superadmin, and RLS
 * is the real defence: every table and function the consoles touch checks
 * `is_superadmin()` itself. This helper exists so a server page or a server
 * action gets the session client and the operator's id in one call, and so an
 * action invoked directly (a server action is a public endpoint) refuses
 * before it does anything.
 */
export type AdminSession = { supabase: SupabaseClient; userId: string };

/** The session's user when they are a superadmin; null otherwise (a support session included). */
export async function requireSuperadmin(): Promise<AdminSession | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("is_superadmin").eq("id", user.id).maybeSingle();
  return profile?.is_superadmin ? { supabase, userId: user.id } : null;
}

/**
 * What a console page renders from. `unavailable` is a clone without Supabase
 * (the layout lets it through so the consoles stay browsable) or a session that
 * lost the role between the layout and the page; `error` is a read that failed.
 * Neither is ever shown as an empty list.
 */
export type ConsoleState<T> = ({ kind: "ready" } & T) | { kind: "error" } | { kind: "unavailable" };

/** Runs a console's reads under the operator's session and folds the three outcomes. */
export async function loadConsole<T extends object>(
  read: (session: AdminSession) => Promise<T>,
): Promise<ConsoleState<T>> {
  const session = await requireSuperadmin();
  if (!session) return { kind: "unavailable" };
  try {
    return { kind: "ready", ...(await read(session)) };
  } catch {
    return { kind: "error" };
  }
}
