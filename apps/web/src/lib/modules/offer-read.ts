import "server-only";

import type { MemberContext } from "@/lib/member/context";
import { type ModuleOffer, moduleOfferOf } from "@/lib/modules/offer";

/**
 * The modules the person's firm contracted and the ones to come (migration 0075), under the person's own session;
 * null with no firm, or when either read failed (a screen then says nothing of the modules, never "none").
 */
export async function readModuleOffer(context: MemberContext | null): Promise<ModuleOffer | null> {
  if (!context?.firm) return null;
  const [catalog, firm] = await Promise.all([
    context.supabase.from("product_modules").select("key, name, status, sold_as, description, sort, retired_at"),
    context.supabase.from("firm_modules").select("module_key, enabled_at").eq("org_id", context.firm.id),
  ]);
  if (catalog.error || firm.error) return null;
  return moduleOfferOf(catalog.data, firm.data);
}
