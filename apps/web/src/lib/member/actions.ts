"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@flyee/auth/server";

/**
 * What a person changes about their own account, through the database
 * function that owns the rule (support-session fence, audit). The session is
 * their own; nothing here trusts an id beyond what the function re-checks.
 *
 * Every action answers `{ ok, code? }` with the function's own code
 * (`support_session`, …), so the screen can say why in words.
 */

export type MemberActionResult = { ok: true } | { ok: false; code: string };

async function call(fn: string, args: Record<string, unknown>): Promise<MemberActionResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, code: error.code === "42501" ? "not_authenticated" : "failed" };
    const result = (data ?? {}) as { ok?: boolean; code?: string };
    if (result.ok === false) return { ok: false, code: result.code ?? "failed" };
    return { ok: true };
  } catch {
    return { ok: false, code: "failed" };
  }
}

export type ProfileUpdate = {
  displayName?: string;
  timezone?: string;
};

/** The person's own name and timezone. A field left out keeps its value. */
export async function updateProfile(update: ProfileUpdate): Promise<MemberActionResult> {
  const result = await call("update_member_profile", {
    p_display_name: update.displayName ?? null,
    p_timezone: update.timezone ?? null,
  });
  if (result.ok) {
    revalidatePath("/inicio");
    revalidatePath("/settings");
  }
  return result;
}
