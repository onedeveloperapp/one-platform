"use server";

import { logBillingFailure, requireOrgManager } from "./billing-server";
import { revalidatePath } from "next/cache";

import { createServiceClient } from "@flyee/auth/service";
import { getProvider } from "@flyee/billing";

export type ChangeTierResult =
  | { ok: true; planName: string; up: boolean }
  | { ok: false; code: string; factor?: "missing" | "challenge" };

/**
 * A change of tier on the subscription in force (migration 0202): the database says whether this person may, with the
 * second factor, to a plan of the same period; Asaas takes the new value from the next charge on; the backend records
 * it. Nothing changes in ONE until Asaas took it, and a record that fails after Asaas took it is recorded again on the
 * next try, since recording the same change twice answers the same.
 */
export async function changeTier(orgId: string, planId: string): Promise<ChangeTierResult> {
  let session: Awaited<ReturnType<typeof requireOrgManager>>;
  try {
    session = await requireOrgManager(orgId);
  } catch {
    return { ok: false, code: "not_allowed" };
  }
  const { supabase, user } = session;
  const { data, error } = await supabase.rpc("begin_plan_change", { target_org: orgId, target_plan: planId });
  if (error) return { ok: false, code: "unavailable" };
  const begun = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    subscription_id?: string;
    provider_subscription_id?: string;
    price_cents?: number;
    plan_name?: string;
    up?: boolean;
  };
  if (begun.ok !== true) {
    const code = begun.code ?? "unavailable";
    if (code !== "second_factor") return { ok: false, code };
    const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return { ok: false, code, factor: assurance?.nextLevel === "aal2" ? "challenge" : "missing" };
  }
  if (!begun.subscription_id || !begun.provider_subscription_id || !begun.price_cents) {
    return { ok: false, code: "unavailable" };
  }
  try {
    await getProvider("asaas").changeSubscription({
      providerSubscriptionId: begun.provider_subscription_id,
      priceCents: begun.price_cents,
      description: begun.plan_name ? `ONE · ${begun.plan_name}` : undefined,
    });
  } catch (providerError) {
    logBillingFailure("plan_change_provider_failed", { orgId, planId }, providerError);
    return { ok: false, code: "provider_unavailable" };
  }
  const { data: recorded, error: recordError } = await createServiceClient().rpc("commit_plan_change", {
    target_subscription: begun.subscription_id,
    target_plan: planId,
    target_actor: user.id,
  });
  if (recordError || (recorded as { ok?: boolean } | null)?.ok !== true) {
    // Asaas has the new value: the same change asked again records it.
    logBillingFailure("plan_change_unrecorded", { orgId, planId }, recordError ?? undefined);
    return { ok: false, code: "unrecorded" };
  }
  revalidatePath("/settings/billing");
  return { ok: true, planName: begun.plan_name ?? "", up: begun.up === true };
}
