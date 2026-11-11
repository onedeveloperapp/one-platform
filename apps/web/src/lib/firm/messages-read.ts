import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's own words of one of ONE's messages, in force (migration 0191), for the backend that writes it; null when
 * the firm kept ONE's, or the read failed (ONE's words go then, as they always did).
 */
export async function firmMessageText(service: SupabaseClient, orgId: string, key: string): Promise<string | null> {
  try {
    const { data, error } = await service
      .from("firm_message_texts")
      .select("body")
      .eq("org_id", orgId)
      .eq("key", key)
      .eq("active", true)
      .maybeSingle();
    if (error || !data) return null;
    const body = (data as { body?: unknown }).body;
    return typeof body === "string" && body.trim() ? body : null;
  } catch {
    return null;
  }
}

/** The same, for the firm of a case. Never throws. */
export async function firmMessageTextOfCase(
  service: SupabaseClient,
  caseId: string,
  key: string,
): Promise<string | null> {
  try {
    const { data } = await service.from("cases").select("org_id").eq("id", caseId).maybeSingle();
    const orgId = (data as { org_id?: unknown } | null)?.org_id;
    return typeof orgId === "string" ? await firmMessageText(service, orgId, key) : null;
  } catch {
    return null;
  }
}
