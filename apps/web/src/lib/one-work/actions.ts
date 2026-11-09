"use server";

import { getMemberContext } from "@/lib/member/context";
import { estimatesInputOf } from "@/lib/one-work/estimates";

/** What came of saving the firm's estimates: done, or the code of what went wrong (`estimatesErrorKey`). */
export type EstimatesResult = { ok: true } | { ok: false; code: string };

/**
 * Saves the firm's estimates of ONE's work (migrations 0120 and 0121): the minutes of each kind named (null goes back to ONE's)
 * and, when said, the average cost of an hour. The database decides who may (who decides for the firm, never a
 * support visit) and puts the change on the record, never with the cost.
 */
export async function saveOneWorkEstimates(input: unknown): Promise<EstimatesResult> {
  const read = estimatesInputOf(input);
  if (!read.ok) return { ok: false, code: read.code };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_one_work_estimates", {
    target_org: context.firm.id,
    target_minutes: read.minutes,
    target_set_cost: read.setCost,
    target_hour_cents: read.hourCents,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: unknown; code?: unknown };
  return answer.ok === true
    ? { ok: true }
    : { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
}
