"use server";

import { revalidatePath } from "next/cache";

import { requireSuperadmin } from "@/lib/admin/session";

/**
 * The operator's acts on the versions of a module (migration 0212). The database checks who asks, keeps a published
 * version as it is, and records each act on the record; these only carry the request and say what came of it.
 */
export type VersionResult = { ok: true; version?: number } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODULE = /^[a-z][a-z0-9-]{2,40}$/;

function settled(answer: unknown, error: { message: string } | null): VersionResult {
  if (error) return { ok: false, code: error.message.includes("not_authorized") ? "forbidden" : "failed" };
  const data = (answer ?? {}) as { ok?: boolean; code?: string; version?: number };
  if (!data.ok) return { ok: false, code: String(data.code ?? "failed") };
  revalidatePath("/admin/modulos");
  return { ok: true, version: typeof data.version === "number" ? data.version : undefined };
}

/** Prepares the next version with what is in force now; a draft there was is replaced. */
export async function draftModuleVersion(module: string, note: string): Promise<VersionResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!MODULE.test(module)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_draft_module_version", {
    target_module: module,
    target_note: String(note ?? "").trim(),
  });
  return settled(data, error);
}

/** Publishes a draft: every case opened from now on is opened under it. */
export async function publishModuleVersion(versionId: string): Promise<VersionResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(versionId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_publish_module_version", { target_version: versionId });
  return settled(data, error);
}

/** Withdraws a published version for a defect: its cases read the latest published from then on. */
export async function withdrawModuleVersion(versionId: string, reason: string): Promise<VersionResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(versionId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_withdraw_module_version", {
    target_version: versionId,
    target_reason: String(reason ?? "").trim(),
  });
  return settled(data, error);
}

/** Discards a draft. */
export async function discardModuleVersion(versionId: string): Promise<VersionResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(versionId)) return { ok: false, code: "not_found" };
  const { data, error } = await session.supabase.rpc("admin_discard_module_version", { target_version: versionId });
  return settled(data, error);
}
