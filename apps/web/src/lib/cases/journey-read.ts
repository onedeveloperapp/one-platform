import "server-only";

import { journeyCounts, journeyGroupsOf } from "@/lib/cases/journey";
import type { SupabaseClient } from "@supabase/supabase-js";

export type JourneyOverview = ReturnType<typeof journeyCounts>;

/**
 * How many of a firm's cases are at each step of their way (`firm_case_journey`, 0082), under the session the
 * person carries: of one module, or of every one. Null when the database did not answer, and then the home shows
 * nothing of it rather than counts that are not.
 */
export async function readCaseJourney(
  supabase: SupabaseClient,
  orgId: string,
  module: string | null = null,
): Promise<JourneyOverview | null> {
  const { data, error } = await supabase.rpc("firm_case_journey", { target_org: orgId, target_module: module });
  if (error) return null;
  const groups = journeyGroupsOf(data);
  return groups ? journeyCounts(groups) : null;
}
