import "server-only";

import { type AreaChoice, areaChoicesFrom } from "@/lib/cases/area-choices";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The areas of the firm a person opens a case of by hand (0292), read under the person's own session. Null when the
 * database did not answer: the page says it could not read, never that the firm has no area.
 */
export async function readAreaChoices(supabase: SupabaseClient, firmId: string): Promise<AreaChoice[] | null> {
  const [areas, laws, scripts] = await Promise.all([
    supabase.from("firm_areas").select("id, name, law_area").eq("org_id", firmId).is("removed_at", null),
    supabase.from("law_areas").select("key, module"),
    supabase
      .from("firm_area_scripts")
      .select("area_id, version, tipos:script->tipos")
      .eq("org_id", firmId)
      .eq("status", "published"),
  ]);
  if (areas.error || laws.error || scripts.error) return null;
  return areaChoicesFrom(areas.data ?? [], laws.data ?? [], scripts.data ?? []);
}
