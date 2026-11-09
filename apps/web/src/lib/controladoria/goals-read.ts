import "server-only";

import { type ClosingGoals, closingGoalsOf } from "@/lib/controladoria/goals";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's closing goals (`firm_closing_goals`, migration 0113), of every module or of one, under the person's own
 * session; null when the database did not answer them.
 */
export async function readClosingGoals(
  supabase: SupabaseClient,
  orgId: string,
  module: string | null,
): Promise<ClosingGoals | null> {
  const { data, error } = await supabase.rpc("firm_closing_goals", { target_org: orgId, target_module: module });
  if (error) return null;
  return closingGoalsOf(data);
}
