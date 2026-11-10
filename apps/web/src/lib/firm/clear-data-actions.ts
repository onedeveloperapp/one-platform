"use server";

import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import { type ClearPreview, clearPreviewOf, type ClearResult, clearResultOf } from "@/lib/firm/clear-data";
import { getMemberContext } from "@/lib/member/context";
import { notifyLocalized } from "@/lib/notifications";
import { createServiceClient } from "@flyee/auth/service";

/** How many paths one call to the storage removes. */
const PATHS_PER_CALL = 100;

/** What a clearing would take now, read again when the person opens the confirmation. */
export async function readClearPreview(): Promise<ClearPreview> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("firm_clear_preview", { target_org: context.firm.id });
  if (error) return { ok: false, code: "failed" };
  return clearPreviewOf(data);
}

/**
 * Removes the bytes of the files whose records the clearing took, then their rows of the backend's list of removals.
 * Best effort: what is not removed here stays listed, and the daily sweep removes it (records first, bytes after).
 */
async function removeBytes(paths: string[]): Promise<void> {
  if (paths.length === 0 || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const service = createServiceClient();
  for (let at = 0; at < paths.length; at += PATHS_PER_CALL) {
    const chunk = paths.slice(at, at + PATHS_PER_CALL);
    try {
      const { error } = await service.storage.from(FIRM_FILES_BUCKET).remove(chunk);
      if (error) return;
      await service.rpc("pax_file_removals_done", { target_paths: chunk });
    } catch {
      return;
    }
  }
}

/**
 * Tells the firm's other partners and who manages it that its cases and clients were cleared: in a firm in use it took
 * real data, and whoever did not expect it should know. Best effort, as the portfolio's notice.
 */
async function tellCleared(firm: string, who: string, name: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const { data, error } = await createServiceClient()
      .from("memberships")
      .select("user_id, role, firm_function")
      .eq("org_id", firm);
    if (error) return;
    const others = ((data ?? []) as { user_id: string; role: string; firm_function: string }[])
      .filter((member) => member.user_id !== who)
      .filter((member) => member.firm_function === "socio" || member.role === "owner" || member.role === "admin")
      .map((member) => member.user_id);
    await notifyLocalized(others, (copy) => copy.firmDataCleared(name), { type: "team", href: "/settings/dados" });
  } catch {
    // Best effort, as above.
  }
}

/**
 * Clears the firm's cases, clients and conversations (migration 0161), under the person's own session: the database
 * says who may (who decides for the firm, with the second factor, never in a support visit), checks the typed word
 * again and keeps the clearing on the record. The bytes of the files that went are removed after the answer.
 */
export async function clearFirmData(typed: unknown): Promise<ClearResult> {
  if (typeof typed !== "string" || typed.length > 40) return { ok: false, code: "confirm_missing" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("clear_firm_data", {
    target_org: context.firm.id,
    target_confirm: typed,
  });
  if (error) return { ok: false, code: "failed" };
  const { result, paths } = clearResultOf(data);
  if (result.ok) {
    await removeBytes(paths);
    await tellCleared(context.firm.id, context.userId, context.profile.displayName);
  }
  return result;
}
