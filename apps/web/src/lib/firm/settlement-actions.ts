"use server";

import { getMemberContext } from "@/lib/member/context";

/**
 * The value the firm settles for at least, per kind of problem (migration 0187): read by anybody of the firm, said by
 * who decides for it with the second factor (`set_firm_settlement_floor`), on the record.
 */

export async function readSettlementFloors(): Promise<Record<string, number>> {
  const context = await getMemberContext();
  if (!context?.firm) return {};
  const { data, error } = await context.supabase
    .from("firm_settlement_floors")
    .select("incident, cents")
    .eq("org_id", context.firm.id);
  if (error) return {};
  return Object.fromEntries(
    ((data ?? []) as { incident: string; cents: number }[]).map((row) => [row.incident, Number(row.cents)]),
  );
}

export async function saveSettlementFloor(
  incident: string,
  cents: number | null,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_found" };
  if (!/^[a-z_]{3,40}$/.test(incident)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("set_firm_settlement_floor", {
    target_org: context.firm.id,
    target_incident: incident,
    target_cents: cents,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown };
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.code ?? "failed") };
}
