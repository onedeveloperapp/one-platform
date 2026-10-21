"use server";

import { type ActiveBillingClaim, failBillingClaim, orgOwnerId, requireOrgManager, UUID } from "./billing-server";
import { CANCEL_REASONS, type CancelReason } from "./cancel-reasons";

import { recordAudit } from "@/lib/audit";
import { trackServerEvent } from "@/lib/product-events-server";
import { createServiceClient } from "@flyee/auth/service";
import { getProvider } from "@flyee/billing";

function fallbackPeriodEnd(period: string | null): Date {
  const end = new Date();
  if (period === "weekly") end.setDate(end.getDate() + 7);
  else if (period === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

/**
 * Cancels at the end of the paid period, with the reason the member gave
 * (docs/BILLING.md, cancellation). Access continues until then, the
 * subscription stops renewing at the provider, and the settle job turns it
 * into the free plan when the period ends. Refunds are not decided here: they
 * happen in the provider's panel, and the provider's refund webhook reverts
 * the invoice.
 */
export async function scheduleSubscriptionCancellation(
  orgId: string,
  idempotencyKey: string,
  reason?: CancelReason | null,
  note?: string | null,
): Promise<{ error?: string }> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(orgId);
    if (!UUID.test(idempotencyKey)) return { error: "unavailable" };
    const cleanReason = CANCEL_REASONS.find((candidate) => candidate === reason) ?? null;
    const cleanNote = note?.trim().slice(0, 500) || null;

    const { data: sub } = await supabase
      .from("subscriptions")
      .select(
        "id, provider, provider_subscription_id, period, current_period_end, cancel_at_period_end, renews, plans(is_free, tier)",
      )
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) return { error: "unavailable" };
    const planInfo = sub.plans as unknown as { is_free: boolean; tier: string | null } | null;
    if (planInfo?.is_free) return { error: "unavailable" };
    if (sub.cancel_at_period_end) return {};

    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: orgId,
      target_actor: user.id,
      target_kind: "cancel",
      target_idempotency_key: idempotencyKey,
      target_provider: sub.provider ?? null,
      target_plan: null,
      target_subscription: sub.id,
    });
    const claim = claimData as { ok?: boolean; code?: string; operationId?: string; claimToken?: string } | null;
    if (claim?.code === "completed") return {};
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) return { error: "unavailable" };
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const storedEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
    const expectedPeriodEnd = storedEnd && storedEnd > new Date() ? storedEnd : fallbackPeriodEnd(sub.period);
    let providerPeriodEnd: Date | undefined;
    // A purchase split into installments has no provider subscription to stop:
    // it never renews in the first place.
    if (sub.provider && sub.provider_subscription_id) {
      const result = await getProvider(sub.provider).scheduleCancellation(
        sub.provider_subscription_id,
        expectedPeriodEnd,
      );
      providerPeriodEnd = result.currentPeriodEnd;
    }

    const currentPeriodEnd = providerPeriodEnd ?? expectedPeriodEnd;
    const { data: completionData, error: completionError } = await service.rpc("commit_billing_subscription_change", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_subscription: sub.id,
      target_kind: "cancel",
      target_current_period_end: currentPeriodEnd.toISOString(),
      target_cancel_reason: cleanReason,
      target_cancel_note: cleanNote,
    });
    const completion = completionData as { ok?: boolean } | null;
    if (completionError || !completion?.ok) {
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;
    await recordAudit(supabase, "subscription.cancellation_scheduled", {
      orgId,
      entityType: "subscription",
      entityId: sub.id,
      metadata: { currentPeriodEnd: currentPeriodEnd.toISOString(), reason: cleanReason },
    });
    // The reason enters the metrics; the free-text note stays on the
    // subscription for the operator (product events never carry content).
    try {
      await trackServerEvent({
        actorId: (await orgOwnerId(service, orgId)) ?? user.id,
        orgId,
        event: "subscription.cancel_requested",
        properties: {
          ...(cleanReason ? { reason: cleanReason } : {}),
          ...(planInfo?.tier ? { tier_from: planInfo.tier } : {}),
        },
      });
    } catch {
      // Measurement never undoes a cancellation she asked for.
    }

    return {};
  } catch {
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}

/** Undoes a scheduled cancellation while the paid period is still running. */
export async function undoSubscriptionCancellation(orgId: string, idempotencyKey: string): Promise<{ error?: string }> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(orgId);
    if (!UUID.test(idempotencyKey)) return { error: "unavailable" };
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, provider, provider_subscription_id, cancel_at_period_end, current_period_end, renews")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .eq("cancel_at_period_end", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub || (sub.current_period_end && new Date(sub.current_period_end) <= new Date()))
      return { error: "unavailable" };
    // A one-off yearly purchase was never going to renew: there is nothing to
    // resume, and pretending otherwise would promise a charge nobody set up.
    if (sub.renews === false) return { error: "not_renewable" };
    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: orgId,
      target_actor: user.id,
      target_kind: "resume",
      target_idempotency_key: idempotencyKey,
      target_provider: sub.provider ?? null,
      target_plan: null,
      target_subscription: sub.id,
    });
    const claim = claimData as { ok?: boolean; code?: string; operationId?: string; claimToken?: string } | null;
    if (claim?.code === "completed") return {};
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) return { error: "unavailable" };
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };
    if (sub.provider && sub.provider_subscription_id) {
      await getProvider(sub.provider).resumeSubscription(sub.provider_subscription_id);
    }
    const { data: completionData, error: completionError } = await service.rpc("commit_billing_subscription_change", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_subscription: sub.id,
      target_kind: "resume",
      target_current_period_end: null,
    });
    const completion = completionData as { ok?: boolean } | null;
    if (completionError || !completion?.ok) {
      await failBillingClaim(activeClaim, "local_reconciliation_failed");
      activeClaim = null;
      return { error: "unavailable" };
    }
    activeClaim = null;
    await recordAudit(supabase, "subscription.cancellation_undone", {
      orgId,
      entityType: "subscription",
      entityId: sub.id,
    });
    return {};
  } catch {
    await failBillingClaim(activeClaim, "provider_unavailable");
    return { error: "unavailable" };
  }
}
