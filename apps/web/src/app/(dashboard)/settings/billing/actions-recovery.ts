"use server";

import { appOrigin, logBillingFailure, requireOrgManager } from "./billing-server";

import { recordAudit } from "@/lib/audit";
import { getProvider } from "@flyee/billing";

/**
 * Retires a checkout the customer walked away from.
 *
 * On Asaas the subscription is created at the START of checkout, before any
 * payment: closing the tab leaves a live recurring charge that nothing in the
 * product could see or stop, and the local row sat `incomplete` forever. When
 * that charge came due, the workspace received a failed invoice for something
 * it never contracted — with no button anywhere to end it.
 */
export async function abandonPendingCheckout(orgId: string, subscriptionId: string): Promise<{ error?: string }> {
  try {
    const { supabase } = await requireOrgManager(orgId);
    const { data, error } = await supabase.rpc("abandon_incomplete_subscription", {
      target_org: orgId,
      target_subscription: subscriptionId,
    });
    if (error) return { error: "unavailable" };
    const result = data as { ok?: boolean; provider?: string | null; providerSubscriptionId?: string | null } | null;
    if (result?.ok !== true) return { error: "unavailable" };

    // Local state is already correct. Stopping the provider is what actually
    // prevents the charge, but a failure here must not undo the cancellation
    // the customer just asked for — it is logged and swept by the reaper.
    if (result.providerSubscriptionId && (result.provider === "stripe" || result.provider === "asaas")) {
      try {
        await getProvider(result.provider).cancelSubscription(result.providerSubscriptionId);
      } catch (providerError) {
        logBillingFailure("abandon_provider_cancel_failed", { orgId, subscriptionId }, providerError);
      }
    }
    await recordAudit(supabase, "subscription.checkout_abandoned", {
      orgId,
      entityType: "subscription",
      entityId: subscriptionId,
    });
    return {};
  } catch (error) {
    logBillingFailure("abandon_checkout_threw", { orgId, subscriptionId }, error);
    return { error: "unavailable" };
  }
}

export type PaymentRecoveryResult = { url?: string; error?: "unavailable" | "not_needed" };

/**
 * Where a workspace with a failed charge actually pays.
 *
 * Two providers, two shapes: Stripe has a hosted Billing Portal for the card
 * behind the subscription; Asaas bills per charge, so the failed invoice's own
 * hosted URL IS the payment page. Prefer the portal, fall back to the invoice,
 * and say "unavailable" only when neither exists.
 */
export async function startPaymentRecovery(orgId: string): Promise<PaymentRecoveryResult> {
  try {
    const { supabase } = await requireOrgManager(orgId);

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, status, provider, provider_customer_id, provider_subscription_id")
      .eq("org_id", orgId)
      .in("status", ["trialing", "active", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sub?.provider === "stripe" && sub.provider_customer_id) {
      const url = await getProvider("stripe").billingPortalUrl?.({
        providerCustomerId: sub.provider_customer_id,
        providerSubscriptionId: sub.provider_subscription_id ?? undefined,
        returnUrl: `${await appOrigin()}/settings/billing`,
      });
      if (url) return { url };
    }

    // The most recent unpaid invoice OF THIS SUBSCRIPTION — for Asaas this is
    // the payment page, and for Stripe the fallback when the portal has no
    // configuration yet. Scoped to the subscription so an unrelated failed
    // charge on the same workspace is never handed over as "your plan".
    let invoiceQuery = supabase
      .from("invoices")
      .select("invoice_url, status, created_at")
      .eq("org_id", orgId)
      .eq("status", "failed")
      .not("invoice_url", "is", null);
    if (sub?.id) invoiceQuery = invoiceQuery.eq("subscription_id", sub.id);
    const { data: invoice } = await invoiceQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (invoice?.invoice_url) return { url: invoice.invoice_url };

    // Nothing to recover: no failed charge on file and no portal.
    if (sub?.status !== "past_due") return { error: "not_needed" };
    return { error: "unavailable" };
  } catch {
    return { error: "unavailable" };
  }
}
