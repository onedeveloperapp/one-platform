"use server";

import { readUsagePanel, type UsagePanel } from "@/lib/billing-usage";
import { createClient } from "@flyee/auth/server";

/**
 * The panel of use of a firm (migration 0202), for who manages its account or decides for it: null for anybody else,
 * and an answer that says it failed when it could not be read.
 */
export async function readFirmUsage(orgId: string): Promise<{ ok: true; panel: UsagePanel | null } | { ok: false }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("firm_usage", { target_org: orgId });
  if (error) return { ok: false };
  return { ok: true, panel: readUsagePanel(data) };
}
