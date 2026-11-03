"use server";

import { revalidatePath } from "next/cache";

import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";

/**
 * A module's setup in a firm (migration 0081), as a server action: who manages the firm says it is answered,
 * finished or set aside. The firm always comes from the caller's own session, and the database checks the module
 * is the firm's and keeps it on the firm's record.
 */

export type ModuleSetupResult = { ok: true; code: string } | { ok: false; code: string };

const KNOWN_CODES = ["not_allowed_in_support_session", "not_authorized"] as const;

const MODULE_KEY = /^[a-z][a-z0-9-]{2,40}$/;

export async function answerModuleSetup(moduleKey: string): Promise<ModuleSetupResult> {
  const context = await getMemberContext();
  const firm = context?.firm ?? null;
  if (!context || !firm || !isManager(firm.role) || !MODULE_KEY.test(moduleKey)) {
    return { ok: false, code: "not_authorized" };
  }
  const { data, error } = await context.supabase.rpc("answer_module_setup", {
    target_org: firm.id,
    target_module: moduleKey,
  });
  if (error) {
    return { ok: false, code: KNOWN_CODES.find((code) => (error.message ?? "").includes(code)) ?? "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/inicio");
  return { ok: true, code: String(answer.code ?? "answered") };
}
