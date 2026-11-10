"use server";

import { getMemberContext } from "@/lib/member/context";
import { readPeopleSearch } from "@/lib/search/global-search";

/**
 * The people and the conversations of the firm that what was typed names (migration 0133), for the search at the top.
 * What was typed travels in the request's body, never in an address.
 */
export async function searchPeople(
  typed: string,
): Promise<{ ok: true; found: ReturnType<typeof readPeopleSearch> } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const { data, error } = await context.supabase.rpc("firm_people_search", {
    target_org: context.firm.id,
    target_text: String(typed ?? "").slice(0, 120),
  });
  if (error) return { ok: false };
  return { ok: true, found: readPeopleSearch(data) };
}
