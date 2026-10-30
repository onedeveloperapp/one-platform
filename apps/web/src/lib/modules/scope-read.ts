import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which of a few cases of the firm are of a module (`cases.module`, 0068), under the person's session: for the short
 * lists a page reads beside its own (the publications that still owe a deadline or a hearing), which a page under a
 * module keeps to that module's cases. An item of no case is of no module. Throws when the read fails, as the
 * page's other reads do.
 */
export async function casesInModule(
  supabase: SupabaseClient,
  firmId: string,
  caseIds: readonly (string | null)[],
  module: string,
): Promise<Set<string>> {
  const ids = [...new Set(caseIds.filter((id): id is string => typeof id === "string" && id !== ""))];
  if (ids.length === 0) return new Set();
  const { data, error } = await supabase
    .from("cases")
    .select("id")
    .eq("org_id", firmId)
    .eq("module", module)
    .in("id", ids);
  if (error) throw new Error("the module of the cases could not be read");
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}
