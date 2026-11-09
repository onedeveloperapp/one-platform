import "server-only";

import { monthDay, type OneWork, oneWorkOf } from "@/lib/one-work/work";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What ONE did for the firm from one month to another (`firm_one_work`, migrations 0120 and 0121), of every module or of one,
 * under the person's own session: the firm's estimates and the money only to who decides for it. Null when the
 * database did not answer, which is never said as a month with nothing.
 */
export async function readOneWork(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
  module: string | null,
): Promise<OneWork | null> {
  const { data, error } = await supabase.rpc("firm_one_work", {
    target_org: orgId,
    target_from: monthDay(from),
    target_to: monthDay(to),
    target_module: module,
  });
  if (error) return null;
  return oneWorkOf(data);
}
