import "server-only";

import type { MemberContext } from "@/lib/member/context";
import { type ModuleSetup, moduleSetupsOf } from "@/lib/modules/module-setups";
import { firmSetupOf } from "@/lib/modules/registry";

/**
 * The setups of the modules the person's firm contracted (migration 0081), read under their session: the firm's
 * rows of `firm_modules` against the catalog of the member context. Null when it could not be read, which hides
 * what depends on it and never says a module was set up.
 */
export async function readModuleSetups(context: MemberContext): Promise<ModuleSetup[] | null> {
  if (!context.firm) return null;
  const { data, error } = await context.supabase
    .from("firm_modules")
    .select("module_key, setup_answered_at")
    .eq("org_id", context.firm.id);
  if (error) return null;
  return moduleSetupsOf(context.catalog, data, firmSetupOf);
}
