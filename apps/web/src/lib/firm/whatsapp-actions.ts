"use server";

import { createClient } from "@flyee/auth/server";

/**
 * The person's own WhatsApp (migration 0187), written by `set_my_whatsapp` for the person asking and nobody else; an
 * empty value takes it off. The database checks the number and refuses a support visit.
 */
export async function saveMyWhatsapp(digits: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const supabase = await createClient();
  const value = String(digits ?? "")
    .replace(/\D/g, "")
    .slice(0, 13);
  const { data, error } = await supabase.rpc("set_my_whatsapp", { target_phone: value || null });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown };
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.code ?? "failed") };
}
