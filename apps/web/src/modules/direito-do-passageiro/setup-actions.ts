"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";

/**
 * What a firm sets up of the passenger module (migration 0081), as server actions: the words of the clause its
 * partner agencies register in their contracts. The firm always comes from the caller's own session; the database
 * decides who may give them (who decides for the firm, with the second factor, never in a support visit).
 */

export type FirmClauseResult = { ok: true; code: string; version: number | null } | { ok: false; code: string };

const KNOWN_CODES = ["second_factor_required", "not_allowed_in_support_session", "not_authorized"] as const;

export async function saveFirmClause(body: string): Promise<FirmClauseResult> {
  const context = await getMemberContext();
  const firm = context?.firm ?? null;
  if (!context || !firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("pax_save_firm_clause", {
    target_org: firm.id,
    target_body: String(body ?? "").slice(0, 2000),
  });
  if (error) {
    return { ok: false, code: KNOWN_CODES.find((code) => (error.message ?? "").includes(code)) ?? "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string; version?: unknown };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/configurar/direito-do-passageiro");
  const version = Number(answer.version);
  return { ok: true, code: String(answer.code ?? "saved"), version: Number.isFinite(version) ? version : null };
}
