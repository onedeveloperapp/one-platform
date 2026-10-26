"use server";

import { revalidatePath } from "next/cache";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { type Incident, INCIDENTS } from "@/lib/cases/cases";
import { isAutonomyDecision, isAutonomyMode } from "@/lib/firm/autonomy";
import { getMemberContext } from "@/lib/member/context";

export type AutonomyResult = { ok: true; code: string } | { ok: false; code: string };

const isIncident = (value: unknown): value is Incident => (INCIDENTS as readonly unknown[]).includes(value);

/**
 * A partner chooses how ONE takes a decision of the firm (migration 0016,
 * `set_firm_autonomy`): the database checks the function, the second factor
 * and that the way is one of the decision's, and records the change.
 */
export async function setFirmAutonomy(
  decision: string,
  mode: string,
  samplePercent: number | null,
): Promise<AutonomyResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isAutonomyDecision(decision) || !isAutonomyMode(mode)) return { ok: false, code: "failed" };
  const sample =
    mode === "sampled" &&
    Number.isInteger(samplePercent) &&
    (samplePercent as number) >= 1 &&
    (samplePercent as number) <= 100
      ? samplePercent
      : null;
  const { data, error } = await context.supabase.rpc("set_firm_autonomy", {
    target_org: context.firm.id,
    target_decision: decision,
    target_mode: mode,
    target_sample_percent: sample,
  });
  if (error) {
    if (error.message.includes("second_factor_required")) return { ok: false, code: "second_factor" };
    if (error.message.includes("not_allowed_in_support_session"))
      return { ok: false, code: "not_allowed_in_support_session" };
    return { ok: false, code: "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/settings/autonomia");
  // The cases the change woke are looked at now (0039).
  await queueCaseAdvance(null);
  return { ok: true, code: "saved" };
}

/**
 * A partner says the claim the firm asks, by default, for a kind of problem,
 * or takes it off with no amount (migration 0052, `set_firm_claim_default`):
 * the database checks the function, the second factor, the kind and the
 * amount, and records the change. ONE writes it for a claimant nobody set a
 * claim for, and the cases that waited for a claim are looked at now.
 */
export async function setFirmClaimDefault(incident: string, cents: number | null): Promise<AutonomyResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isIncident(incident)) return { ok: false, code: "failed" };
  if (cents !== null && (!Number.isInteger(cents) || cents < 1 || cents > 100_000_000_000)) {
    return { ok: false, code: "invalid_amount" };
  }
  const { data, error } = await context.supabase.rpc("set_firm_claim_default", {
    target_org: context.firm.id,
    target_incident: incident,
    target_cents: cents,
  });
  if (error) {
    if (error.message.includes("second_factor_required")) return { ok: false, code: "second_factor" };
    if (error.message.includes("not_allowed_in_support_session"))
      return { ok: false, code: "not_allowed_in_support_session" };
    return { ok: false, code: "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/settings/autonomia");
  if (answer.code === "saved") await queueCaseAdvance(null);
  return { ok: true, code: String(answer.code ?? "saved") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A partner names a partner or a lawyer to sign what ONE prepares, or stops
 * naming them (migration 0039, `set_firm_signer`): the database checks the
 * function, the second factor and who may sign, and records the change.
 */
export async function setFirmSigner(userId: string, signs: boolean): Promise<AutonomyResult> {
  const context = await getMemberContext();
  if (!context?.firm || typeof userId !== "string" || !UUID.test(userId) || typeof signs !== "boolean") {
    return { ok: false, code: "failed" };
  }
  const { data, error } = await context.supabase.rpc("set_firm_signer", {
    target_org: context.firm.id,
    target_user: userId,
    target_signs: signs,
  });
  if (error) {
    if (error.message.includes("second_factor_required")) return { ok: false, code: "second_factor" };
    if (error.message.includes("not_allowed_in_support_session"))
      return { ok: false, code: "not_allowed_in_support_session" };
    return { ok: false, code: "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/settings/autonomia");
  // The cases that waited for somebody to sign are looked at now.
  if (answer.code === "saved") await queueCaseAdvance(null);
  return { ok: true, code: String(answer.code ?? "saved") };
}
