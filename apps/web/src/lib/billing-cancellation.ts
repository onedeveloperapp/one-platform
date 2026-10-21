import { trackWorkspaceEvent } from "@/lib/billing-lifecycle";
import { notifySubscriptionEnded } from "@/lib/billing-notices";
import { createServiceClient } from "@flyee/auth/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * The same single statement the webhook uses.
 *
 * This job and the webhook settle the same cancellations, so they raced: the
 * read-then-insert this replaced lost against `subscriptions_org_live_unique`
 * and raised, which in the webhook's case became a 500 and a provider retry.
 */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { error } = await supabase.rpc("ensure_free_subscription", { target_org: orgId });
  if (error) throw error;
}

/**
 * Finalizes due cancellations: the paid period of a subscription scheduled to
 * end has ended. Safe to retry because only live scheduled rows are selected.
 *
 * This is where a cancellation becomes real (docs/BILLING.md): the workspace
 * returns to the free plan, `subscription.canceled` is recorded, the CLI
 * tokens are revoked only if nothing else (the kit) still grants access, and
 * the member is told what stays and what stops.
 */
export async function settleDueBillingCancellations() {
  const supabase = createServiceClient();
  const { data: due, error } = await supabase
    .from("subscriptions")
    .select(
      "id, org_id, plan_id, provider, provider_subscription_id, cancel_reason, cancellation_requested_at, renews, current_period_end, plans(tier)",
    )
    .eq("cancel_at_period_end", true)
    .in("status", ["trialing", "active", "past_due"])
    .lte("current_period_end", new Date().toISOString());
  if (error) throw error;

  let settled = 0;
  let failed = 0;
  for (const subscription of due ?? []) {
    try {
      // Both providers were already instructed to stop renewal when the member
      // scheduled the cancellation (and a purchase split into installments
      // never renewed). This job only settles local entitlement.
      const { data: updated, error: updateError } = await supabase
        .from("subscriptions")
        .update({
          status: "canceled",
          canceled_at: new Date().toISOString(),
          cancel_at_period_end: false,
        })
        .eq("id", subscription.id)
        .eq("cancel_at_period_end", true)
        .select("id");
      if (updateError) throw updateError;
      await ensureFreeSubscription(supabase, subscription.org_id);
      // Only the run that actually flipped the row reports it.
      if ((updated ?? []).length > 0) {
        const tier = (subscription.plans as unknown as { tier: string | null } | null)?.tier ?? null;
        await trackWorkspaceEvent(supabase, subscription.org_id, "subscription.canceled", {
          ...(subscription.cancel_reason ? { reason: subscription.cancel_reason as string } : {}),
          ...(tier ? { tier_from: tier } : {}),
        });
        // A purchase split into installments ends by itself when its period
        // does; anything else scheduled to end was the member's own request.
        await notifySubscriptionEnded(supabase, {
          orgId: subscription.org_id,
          planId: subscription.plan_id,
          cause: subscription.renews === false && !subscription.cancellation_requested_at ? "term" : "requested",
          endedAt: subscription.current_period_end,
        });
      }
      settled += 1;
    } catch (settleError) {
      failed += 1;
      console.error("Could not settle scheduled subscription cancellation", subscription.id, settleError);
    }
  }
  return { settled, failed };
}
