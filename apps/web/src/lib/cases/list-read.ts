import "server-only";

import { caseListOf, type CaseListPage, type CaseListQuery } from "@/lib/cases/list";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One page of a firm's cases, asked of the database (`firm_cases`, migrations
 * 0033 and 0078) under the session the client carries: the page's first read
 * and every one the screen asks after it are this same call, of every module
 * or of one. Each row says what its lawsuits show in court (0110). Null when the database did not answer a list.
 */
export async function readCaseList(
  supabase: SupabaseClient,
  orgId: string,
  query: CaseListQuery,
): Promise<CaseListPage | null> {
  const { data, error } = await supabase.rpc("firm_cases", {
    target_org: orgId,
    target_filter: query.filter,
    target_search: query.search === "" ? null : query.search,
    target_limit: query.pageSize,
    target_offset: query.page * query.pageSize,
    target_module: query.module,
    target_sort: query.sort ?? null,
    target_incident: query.incident ?? null,
    target_airline: query.airline ?? null,
  });
  if (error) return null;
  return caseListOf(data);
}

/**
 * A page of the list for an export the person began (`firm_cases_export`, 0110): the same list, in pages of the
 * setting's size. Null when the database did not answer one.
 */
export async function readCaseExportPage(
  supabase: SupabaseClient,
  orgId: string,
  query: CaseListQuery,
  offset: number,
): Promise<CaseListPage | null> {
  const { data, error } = await supabase.rpc("firm_cases_export", {
    target_org: orgId,
    target_filter: query.filter,
    target_search: query.search === "" ? null : query.search,
    target_offset: offset,
    target_module: query.module,
    target_sort: query.sort ?? null,
    target_incident: query.incident ?? null,
    target_airline: query.airline ?? null,
  });
  if (error) return null;
  return caseListOf(data);
}
