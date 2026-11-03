"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";
import { isPartnerManager } from "@/lib/partners/partner";

/**
 * The partner's setup (migration 0080), as a server action: who manages the partner says it is answered, finished
 * or set aside. The partner always comes from the caller's own session; the database decides who may say it and
 * keeps it on the platform's record.
 */

export type PartnerSetupResult = { ok: true; code: string } | { ok: false; code: string };

const KNOWN_CODES = ["not_allowed_in_support_session", "not_authorized"] as const;

export async function answerPartnerSetup(): Promise<PartnerSetupResult> {
  const context = await getMemberContext();
  const partner = context?.partner ?? null;
  if (!context || !partner || !isPartnerManager(partner.role)) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("answer_partner_setup", { target_partner: partner.id });
  if (error) {
    return { ok: false, code: KNOWN_CODES.find((code) => (error.message ?? "").includes(code)) ?? "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };
  // The gate reads the answer from the session's partner: the home is the home again.
  revalidatePath("/parceiro", "layout");
  return { ok: true, code: String(answer.code ?? "answered") };
}
