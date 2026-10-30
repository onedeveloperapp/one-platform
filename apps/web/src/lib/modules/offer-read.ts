import "server-only";

import type { MemberContext } from "@/lib/member/context";
import { type ModuleOffer, moduleOfferOf } from "@/lib/modules/offer";

/**
 * The modules the person's firm contracted, the ones to come and the ones it could add (migrations 0075, 0078),
 * under the person's own session: the catalog the member context read for the request, and since when the firm
 * has each. Null with no firm, or when either read failed (a screen then says nothing of the modules, never
 * "none").
 */
export async function readModuleOffer(context: MemberContext | null): Promise<ModuleOffer | null> {
  if (!context?.firm || !context.catalog) return null;
  const firm = await context.supabase
    .from("firm_modules")
    .select("module_key, enabled_at")
    .eq("org_id", context.firm.id);
  if (firm.error) return null;
  return moduleOfferOf(context.catalog, firm.data);
}
