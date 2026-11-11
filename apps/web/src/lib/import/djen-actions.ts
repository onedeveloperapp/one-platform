"use server";

import { type DjenLawsuit, readDjenLawsuits } from "@/lib/import/djen-lawsuits";
import { getMemberContext } from "@/lib/member/context";

/**
 * The lawsuits the DJEN already shows of the firm's lawyers and the firm has no lawsuit of (migration 0208), for who
 * may import the portfolio. A refusal says why.
 */
export async function readFirmDjenLawsuits(): Promise<
  { ok: true; total: number; lawsuits: DjenLawsuit[] } | { ok: false; code: string }
> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("firm_djen_lawsuits", {
    target_org: context.firm.id,
    target_limit: 5000,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  const read = readDjenLawsuits(data);
  return read ? { ok: true, ...read } : { ok: false, code: "failed" };
}
