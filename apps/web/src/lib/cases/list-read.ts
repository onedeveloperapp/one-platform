import "server-only";

import { caseListOf, type CaseListPage, type CaseListQuery } from "@/lib/cases/list";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One page of a firm's cases, asked of the database (`firm_cases`, migrations
 * 0033 and 0078) under the session the client carries: the page's first read
 * and every one the screen asks after it are this same call, of every module
 * or of one. Null when the database did not answer a list.
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
  const page = caseListOf(data);
  return page ? withCourtMarks(supabase, orgId, page) : null;
}

/**
 * What the lawsuits of the page's cases in court show (a hearing held, a decision and a payment published), for
 * the step of their way the list shows: two reads for the whole page, never one per case. A read that failed
 * leaves the rows as they came, the list showing them at the court's first step.
 */
async function withCourtMarks(supabase: SupabaseClient, orgId: string, page: CaseListPage): Promise<CaseListPage> {
  const filed = page.rows.filter((row) => row.status === "filed").map((row) => row.id);
  if (filed.length === 0) return page;
  const publishedOf = (columns: string) =>
    supabase
      .from("publications")
      .select(columns)
      .eq("org_id", orgId)
      .eq("active", true)
      .in("category", ["decisao", "pagamento"])
      .in("case_id", filed);
  const [held, withJudgment] = await Promise.all([
    supabase.from("hearings").select("case_id").eq("org_id", orgId).eq("status", "held").in("case_id", filed),
    publishedOf("case_id, category, judgment"),
  ]);
  // A database without the word on the judgment (before 0096) is read as it was: every decision judged the case.
  const published = withJudgment.error ? await publishedOf("case_id, category") : withJudgment;
  if (held.error || published.error) return page;
  const rows = (published.data ?? []) as unknown as { case_id: string; category: string; judgment?: boolean | null }[];
  const heldCases = new Set((held.data ?? []).map((row) => row.case_id as string));
  // A decision judges a case only when it was said to be the judgment (0096).
  const decided = new Set(
    rows
      .filter((row) => row.category === "decisao" && (withJudgment.error ? true : row.judgment === true))
      .map((row) => row.case_id),
  );
  const paid = new Set(rows.filter((row) => row.category === "pagamento").map((row) => row.case_id));
  return {
    ...page,
    rows: page.rows.map((row) =>
      row.status === "filed"
        ? { ...row, court: { held: heldCases.has(row.id), decided: decided.has(row.id), paid: paid.has(row.id) } }
        : row,
    ),
  };
}
