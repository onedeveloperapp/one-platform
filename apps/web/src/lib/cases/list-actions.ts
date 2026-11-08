"use server";

import { type CaseListPage, caseListQuery } from "@/lib/cases/list";
import { readCaseList, readCaseStock } from "@/lib/cases/list-read";
import type { CaseStock } from "@/lib/cases/standing";
import { getMemberContext } from "@/lib/member/context";

/**
 * One page of the firm's cases (migration 0033), read under the person's own
 * session: the database says whether they may and which firm's cases they
 * are. What is searched travels in the request's body and nowhere else: a
 * client's name or a CPF in an address ends up in logs.
 */
export async function listFirmCases(input: unknown): Promise<{ ok: true; page: CaseListPage } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const page = await readCaseList(context.supabase, context.firm.id, caseListQuery(input));
  return page ? { ok: true, page } : { ok: false };
}

/**
 * The stock of the list's scope (migration 0111), read again when the person changes the module, the kind of problem
 * or the airline: what the views of who has the case count.
 */
export async function readFirmCaseStock(input: unknown): Promise<{ ok: true; stock: CaseStock } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const stock = await readCaseStock(context.supabase, context.firm.id, caseListQuery(input));
  return stock ? { ok: true, stock } : { ok: false };
}
