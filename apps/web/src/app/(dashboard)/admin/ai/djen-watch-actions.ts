"use server";

import { requireSuperadmin } from "@/lib/admin/session";
import { type DjenWatch, readDjenWatch } from "@/lib/publications/djen-watch";

/**
 * The operator's watch over the DJEN (migration 0201): how the public API answers the platform's looks, the latest of
 * them, and the courts whose links point to another system than the table says. Counts only.
 */
export async function readDjenWatchAdmin(): Promise<{ ok: true; watch: DjenWatch } | { ok: false; code: string }> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_djen_watch");
  if (error) return { ok: false, code: "failed" };
  const watch = readDjenWatch(data);
  return watch ? { ok: true, watch } : { ok: false, code: "failed" };
}
