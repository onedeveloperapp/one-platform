"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";

export type ThirdPartyBillPolicy = "accept" | "refuse";

/**
 * Who decides for the firm says whether it accepts a proof of address in somebody else's name with the client's
 * declaration of residence, or asks every client for one in their own name (migration 0123). The database decides who
 * may (never a support visit) and keeps the change on the record. Bills already decided stay as they were.
 */
export async function setThirdPartyBill(
  policy: ThirdPartyBillPolicy,
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (policy !== "accept" && policy !== "refuse") return { ok: false, code: "policy" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_third_party_bill", {
    target_org: context.firm.id,
    target_policy: policy,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: unknown; code?: unknown };
  if (answer.ok !== true) return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
  revalidatePath("/settings/regras");
  return { ok: true };
}
