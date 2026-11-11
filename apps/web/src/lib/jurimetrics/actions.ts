"use server";

import { type MarketNumbers, marketNumbersOf } from "@/lib/jurimetrics/profile";
import { getMemberContext } from "@/lib/member/context";

/**
 * What the screens read of the market (migration 0190): how a lawsuit's unit and its judge decide, beside the whole
 * court, and the projection by unit. Public data, read under the person's session; only to prepare and to project.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type LawsuitMarket =
  | {
      ok: true;
      unit: string | null;
      judge: string | null;
      unitNumbers: MarketNumbers | null;
      judgeNumbers: MarketNumbers | null;
      courtNumbers: MarketNumbers | null;
    }
  | { ok: false; code: string };

/** How a lawsuit's unit and judge decide: the unit the lawsuit records, the judge its course shows. */
export async function readLawsuitMarket(proceedingId: string): Promise<LawsuitMarket> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(proceedingId)) return { ok: false, code: "not_found" };
  const [{ data: lawsuit }, { data: tracking }] = await Promise.all([
    context.supabase
      .from("proceedings")
      .select("court, unit")
      .eq("id", proceedingId)
      .eq("org_id", context.firm.id)
      .maybeSingle(),
    context.supabase.from("proceeding_tracking").select("snapshot").eq("proceeding_id", proceedingId).maybeSingle(),
  ]);
  const court = (lawsuit as { court?: string | null } | null)?.court ?? null;
  if (!court) return { ok: false, code: "not_found" };
  const unit = (lawsuit as { unit?: string | null } | null)?.unit ?? null;
  // The judge as the court's course names them among who answers for the lawsuit (`lib/courts/course-facts.ts`).
  const snapshot = (tracking as { snapshot?: unknown } | null)?.snapshot as { responsibles?: unknown } | null;
  const listed = snapshot?.responsibles;
  const responsibles = Array.isArray(listed) ? (listed as { name?: unknown; role?: unknown }[]) : [];
  const named = responsibles.find((person) => /juiz/i.test(String(person?.role ?? "")))?.name;
  const judge = typeof named === "string" && named.trim() ? named.trim() : null;
  const { data, error } = await context.supabase.rpc("market_profile", {
    target_court: court,
    target_unit: unit,
    target_judge: judge,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { unit?: unknown; judge?: unknown; court?: unknown };
  return {
    ok: true,
    unit,
    judge,
    unitNumbers: marketNumbersOf(answer.unit),
    judgeNumbers: marketNumbersOf(answer.judge),
    courtNumbers: marketNumbersOf(answer.court),
  };
}

export type MarketProjection =
  | { ok: true; rows: { unit: string; numbers: MarketNumbers }[] }
  | { ok: false; code: string };

/** The projection by unit of a court, for an airline and a kind of problem (each optional). */
export async function readMarketProjection(input: {
  court: string;
  airline: string | null;
  problem: string | null;
}): Promise<MarketProjection> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_found" };
  const court = String(input?.court ?? "").toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(court)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("market_projection", {
    target_court: court,
    target_airline: input.airline && /^[A-Z0-9]{2}$/.test(input.airline) ? input.airline : null,
    target_problem: input.problem && /^[a-z]{3,20}$/.test(input.problem) ? input.problem : null,
  });
  if (error) return { ok: false, code: "failed" };
  return {
    ok: true,
    rows: ((Array.isArray(data) ? data : []) as { unit?: unknown; numbers?: unknown }[]).flatMap((row) => {
      const numbers = marketNumbersOf(row.numbers);
      return typeof row.unit === "string" && numbers ? [{ unit: row.unit, numbers }] : [];
    }),
  };
}
