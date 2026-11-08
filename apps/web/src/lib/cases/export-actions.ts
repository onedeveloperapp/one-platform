"use server";

import { type ExportBegun, exportBegunOf } from "@/lib/cases/export";
import { type CaseListPage, caseListQuery } from "@/lib/cases/list";
import { readCaseExportPage } from "@/lib/cases/list-read";
import { getMemberContext } from "@/lib/member/context";

/**
 * The list of cases taken to a spreadsheet (migration 0110), under the person's own session: the database says who
 * may, keeps it on the record and counts the day's. The words searched travel in the request's body and are kept
 * nowhere: the record says only that a search narrowed the list.
 */
export async function beginCaseExport(input: unknown, rows: number): Promise<ExportBegun> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const query = caseListQuery(input);
  const { data, error } = await context.supabase.rpc("begin_case_export", {
    target_org: context.firm.id,
    target_view: query.filter,
    target_module: query.module,
    target_searched: query.search !== "",
    target_rows: Number.isInteger(rows) && rows >= 0 ? rows : 0,
    target_format: "xlsx",
  });
  return error ? { ok: false, code: "failed" } : exportBegunOf(data);
}

/** A page of the list being exported, from the line asked for. */
export async function readCaseExport(
  input: unknown,
  offset: number,
): Promise<{ ok: true; page: CaseListPage } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const page = await readCaseExportPage(
    context.supabase,
    context.firm.id,
    caseListQuery(input),
    Number.isInteger(offset) && offset >= 0 ? offset : 0,
  );
  return page ? { ok: true, page } : { ok: false };
}
