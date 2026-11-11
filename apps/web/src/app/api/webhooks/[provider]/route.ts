import { after, NextResponse } from "next/server";

import { trackUpsellPurchase, trackWorkspaceEvent, workspaceOwner } from "@/lib/billing-lifecycle";
import {
  notifyAccessGranted,
  notifyPaymentFailed,
  notifyPaymentRecovered,
  notifyPlanActive,
  notifySubscriptionEnded,
} from "@/lib/billing-notices";
import { periodEnd, resolveBillingWindow } from "@/lib/billing-window";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { readSignupAttribution } from "@/lib/signup-attribution";
import { logAuditEvent } from "@flyee/audit";
import { createServiceClient } from "@flyee/auth/service";
import {
  applyDiscount,
  type BillingEvent,
  type BillingPeriod,
  type CheckoutCoupon,
  getProvider,
  isTierSlug,
} from "@flyee/billing";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * How many times an event may fail before we stop asking the provider to
 * resend it. Five covers a genuine race with local checkout reconciliation
 * (seconds) with room to spare; beyond that the cause is structural and only
 * an operator can clear it.
 */
const MAX_HANDLER_ATTEMPTS = 5;

/**
 * The provider's patience, minus room to answer.
 *
 * Asaas waits 10 SECONDS for a 200 and counts anything else — a read timeout
 * included — as a delivery failure; 15 consecutive failures INTERRUPT the
 * queue, and nothing is delivered again until a human reactivates it.
 *
 * So the route stops racing the clock: it processes inline until this budget
 * and hands the rest to `after()`, which keeps running after the response goes
 * out. The claim is what makes that safe — a resend lands on
 * `event_in_progress` and is skipped, never duplicated.
 */
const INLINE_BUDGET_MS = 6_000;

/** How long after the checkout campaign a purchase is still credited to it. */
const CAMPAIGN_WINDOW_MS = 14 * 86_400_000;

/** Locates the subscription a provider event refers to. */
async function findSubscription(
  supabase: ServiceClient,
  event: { providerSubscriptionId?: string; providerPaymentRef?: string } & BillingEvent,
) {
  if (event.providerSubscriptionId) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("provider", event.provider)
      .eq("provider_subscription_id", event.providerSubscriptionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  // A yearly plan split into installments is one purchase with no provider
  // subscription: checkout stored its reference (the installment id) in
  // `provider_payment_id`, and every parcel's payment carries it.
  if (event.providerPaymentRef) {
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("provider", event.provider)
      .eq("provider_payment_id", event.providerPaymentRef)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  const orgId = "metadata" in event ? event.metadata.org_id : undefined;
  if (orgId) {
    const planId = "metadata" in event ? event.metadata.plan_id : undefined;
    // The plan filter is what keeps the fallback honest: a checkout whose
    // subscription id never reached the local row is matched by its plan, never
    // by "the most recent incomplete row", which would activate whichever plan
    // was opened last, not the one that was actually paid.
    let query = supabase.from("subscriptions").select("*").eq("org_id", orgId).eq("status", "incomplete");
    if (planId) query = query.eq("plan_id", planId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (data) return data;
  }
  return null;
}

/**
 * Ensures the org lands back on the free plan after a cancellation, in one
 * statement that treats "already live" as success (it races the settle job).
 */
async function ensureFreeSubscription(supabase: ServiceClient, orgId: string) {
  const { data, error } = await supabase.rpc("ensure_free_subscription", { target_org: orgId });
  if (error) throw error;
  if ((data as { ok?: boolean } | null)?.ok !== true) throw new Error("free_plan_reconciliation_failed");
}

/**
 * A provider event that is not about this platform at all.
 *
 * Asaas delivers webhooks for EVERY charge in the account, including ones
 * created by hand in its panel. Those carry no `externalReference` of ours, so
 * they can never reconcile — and treating them as retryable failures is what
 * made the route answer 500 forever, until Asaas suspended the queue and took
 * real activations down with it. Skipping is the correct outcome, and it has
 * to leave a trace or the next incident is equally blind.
 */
function skipForeignEvent(event: BillingEvent, why: string) {
  console.warn("billing_webhook_foreign_event", {
    provider: event.provider,
    providerEventId: event.providerEventId,
    type: event.type,
    why,
  });
}

/**
 * Stop charging a subscription the workspace no longer holds.
 *
 * Retiring the row locally only changes what the platform believes; the
 * provider keeps its own recurring charge alive. An upgrade creates a NEW
 * subscription, so without this the customer is billed twice.
 *
 * The free plan carries no provider id and is skipped. The subscription that
 * just activated is skipped explicitly, so a provider that re-emits the same
 * activation can never cancel the very thing it activated. Failures are
 * logged to the audit trail, not thrown: the local state is already correct.
 */
async function cancelSupersededAtProvider(
  supabase: ServiceClient,
  orgId: string,
  rows: { id: string; provider: string | null; provider_subscription_id: string | null }[],
  keep: { keepProvider: string; keepProviderSubscriptionId: string | null },
) {
  for (const row of rows) {
    if (!row.provider_subscription_id) continue;
    if (row.provider !== "asaas") continue;
    if (row.provider === keep.keepProvider && row.provider_subscription_id === keep.keepProviderSubscriptionId) {
      continue;
    }
    try {
      await getProvider("asaas").cancelSubscription(row.provider_subscription_id);
    } catch (error) {
      // The customer is now being charged twice and nothing in the product
      // knows it: this has to be reviewable in /admin/audit.
      console.error("superseded_subscription_cancel_failed", {
        orgId,
        provider: row.provider,
        providerSubscriptionId: row.provider_subscription_id,
        message: error instanceof Error ? error.message : String(error),
      });
      await logAuditEvent(supabase, {
        orgId,
        actorId: null,
        action: "billing.superseded_cancel_failed",
        entityType: "subscription",
        entityId: row.id,
        metadata: {
          provider: row.provider,
          providerSubscriptionId: row.provider_subscription_id,
          consequence: "double_charge_risk",
        },
      }).catch(() => {
        // Reconciliation already succeeded; the trail is not worth replaying it.
      });
    }
  }
}

/**
 * Retires every live subscription OLDER than the one that just activated
 * (the free plan, or the paid plan being replaced) and stops the replaced
 * one at its provider.
 *
 * Only older rows: without that bound, an out-of-order event for the previous
 * plan would cancel the newer subscription the customer just paid for.
 */
async function retireSuperseded(
  supabase: ServiceClient,
  sub: { id: string; org_id: string; created_at: string },
  keep: { keepProvider: string; keepProviderSubscriptionId: string | null },
) {
  const { data: superseded, error: supersededError } = await supabase
    .from("subscriptions")
    .select("id, provider, provider_subscription_id, created_at")
    .eq("org_id", sub.org_id)
    .in("status", ["trialing", "active", "past_due"])
    .neq("id", sub.id)
    .lt("created_at", sub.created_at);
  if (supersededError) throw new Error("subscription_reconciliation_failed");

  const { error: retireError } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("org_id", sub.org_id)
    .in("status", ["trialing", "active", "past_due"])
    .neq("id", sub.id)
    .lt("created_at", sub.created_at);
  if (retireError) throw new Error("subscription_reconciliation_failed");

  await cancelSupersededAtProvider(supabase, sub.org_id, superseded ?? [], keep);
}

/**
 * Credits a purchase to the campaign of its checkout (migration 0005):
 * reconciliation, not measurement, so it checks its errors and throws for a
 * retry. Idempotent through `invoice_key`. Only with a checkout campaign at
 * most 14 days old: long enough for a PIX that settles late, too short to
 * credit an abandoned attempt.
 */
async function recordPurchaseAttribution(
  supabase: ServiceClient,
  input: {
    orgId: string;
    invoiceKey: string;
    subscriptionId: string | null;
    planSlug: string | null;
    amountCents: number;
    currency: string;
    paidAt: Date;
  },
) {
  const { data: campaignRow, error: campaignError } = await supabase
    .from("meta_attribution")
    .select(
      "campaign_origem, campaign_utm_source, campaign_utm_medium, campaign_utm_campaign, campaign_utm_content, campaign_captured_at",
    )
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (campaignError) throw new Error("purchase_attribution_failed");
  const capturedAt = campaignRow?.campaign_captured_at ? new Date(campaignRow.campaign_captured_at as string) : null;
  const hasValue = Boolean(
    campaignRow?.campaign_origem ||
      campaignRow?.campaign_utm_source ||
      campaignRow?.campaign_utm_medium ||
      campaignRow?.campaign_utm_campaign ||
      campaignRow?.campaign_utm_content,
  );
  if (!capturedAt || !hasValue || input.paidAt.getTime() - capturedAt.getTime() > CAMPAIGN_WINDOW_MS) return;

  const { error: attributionError } = await supabase.from("purchase_attributions").upsert(
    {
      org_id: input.orgId,
      invoice_key: input.invoiceKey,
      subscription_id: input.subscriptionId,
      plan_slug: input.planSlug,
      amount_cents: input.amountCents,
      currency: input.currency,
      paid_at: input.paidAt.toISOString(),
      origem: campaignRow?.campaign_origem ?? null,
      utm_source: campaignRow?.campaign_utm_source ?? null,
      utm_medium: campaignRow?.campaign_utm_medium ?? null,
      utm_campaign: campaignRow?.campaign_utm_campaign ?? null,
      utm_content: campaignRow?.campaign_utm_content ?? null,
      campaign_captured_at: capturedAt.toISOString(),
    },
    { onConflict: "invoice_key", ignoreDuplicates: true },
  );
  if (attributionError) throw new Error("purchase_attribution_failed");
}

/** How many days the dunning window lasts, as configured. */
async function graceDays(supabase: ServiceClient): Promise<number> {
  const { data } = await supabase.from("platform_settings").select("value").eq("key", "dunning").maybeSingle();
  const days = Number((data?.value as { grace_days?: unknown } | null)?.grace_days);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 0;
}

type PlanFacts = {
  id: string;
  slug: string;
  name: string;
  kind: string;
  tier: string | null;
  period: string | null;
  price_cents: number;
};

async function readPlan(supabase: ServiceClient, planId: string | null | undefined): Promise<PlanFacts | null> {
  if (!planId) return null;
  const { data, error } = await supabase
    .from("plans")
    .select("id, slug, name, kind, tier, period, price_cents")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw new Error("plan_reconciliation_failed");
  return (data as PlanFacts | null) ?? null;
}

/**
 * What an access paid in installments was sold for: the plan's price with the
 * coupon of the checkout. A parcel's event carries the parcel's amount, and
 * Asaas never sends the total, so the whole is rebuilt the way the checkout
 * computed it (`applyDiscount`, packages/billing).
 */
async function soldAccessPrice(supabase: ServiceClient, plan: PlanFacts, couponId: string | undefined) {
  if (!couponId) return plan.price_cents;
  const { data } = await supabase
    .from("coupons")
    .select("discount_type, discount_value")
    .eq("id", couponId)
    .maybeSingle();
  if (!data) return plan.price_cents;
  return applyDiscount(plan.price_cents, {
    discountType: data.discount_type,
    discountValue: Number(data.discount_value),
  } as CheckoutCoupon);
}

/**
 * Counts one use of a coupon, atomically and once per purchase
 * (`redeem_coupon`, migration 0020): a subscription claims its use by taking
 * `coupon_id`, so a replay counts nothing; a kit is counted by its first grant.
 */
async function redeemCoupon(supabase: ServiceClient, couponId: string, subscriptionId: string | null) {
  const { data, error } = await supabase.rpc("redeem_coupon", {
    target_coupon: couponId,
    ...(subscriptionId ? { target_subscription: subscriptionId } : {}),
  });
  const result = data as { ok?: boolean } | null;
  if (error || result?.ok !== true) throw new Error("coupon_reconciliation_failed");
}

/**
 * Ends a purchase paid once (a yearly plan split into installments) whose
 * money came back.
 *
 * A renewing subscription is ended by its provider: the operator cancels it
 * there and the deletion webhook lands in `subscription_canceled`. A single
 * purchase has nothing at the provider to delete, so the refund IS the end.
 * Every parcel's refund arrives here; the first closes the term and the rest
 * find it closed.
 */
async function endRefundedSinglePurchase(
  supabase: ServiceClient,
  event: { provider: string; providerInvoiceId: string; kind: "refund" | "chargeback" },
) {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("subscription_id")
    .eq("provider", event.provider)
    .eq("provider_invoice_id", event.providerInvoiceId)
    .maybeSingle();
  if (invoiceError) throw new Error("invoice_reversal_failed");
  if (!invoice?.subscription_id) return;

  const { data: ended, error: endError } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false })
    .eq("id", invoice.subscription_id as string)
    .eq("renews", false)
    .in("status", ["trialing", "active", "past_due"])
    .select("id, org_id, plan_id");
  if (endError) throw new Error("subscription_reconciliation_failed");
  const row = (ended ?? [])[0] as { id: string; org_id: string; plan_id: string } | undefined;
  if (!row) return;

  await ensureFreeSubscription(supabase, row.org_id);
  const plan = await readPlan(supabase, row.plan_id);
  await trackWorkspaceEvent(supabase, row.org_id, "subscription.canceled", plan?.tier ? { tier_from: plan.tier } : {});
  await logAuditEvent(supabase, {
    orgId: row.org_id,
    actorId: null,
    action: "billing.purchase_reverted",
    entityType: "subscription",
    entityId: row.id,
    metadata: { provider: event.provider, kind: event.kind, invoice: event.providerInvoiceId },
  }).catch(() => {
    // The term is already closed in the database.
  });
}

async function handleEvent(supabase: ServiceClient, event: BillingEvent) {
  switch (event.type) {
    case "subscription_activated": {
      const sub = await findSubscription(supabase, event);
      if (!sub) {
        // No org_id in the provider's metadata means this subscription was
        // never created by this platform. Reprocessing can only fail again.
        if (!event.metadata.org_id) {
          skipForeignEvent(event, "unknown_subscription");
          return;
        }
        // Ours, but local checkout reconciliation has not landed yet. This one
        // IS worth retrying: the inbox entry stays reclaimable, with a cap.
        throw new Error("subscription_not_ready");
      }

      // An activation for a subscription we already retired is a stale event —
      // providers do not guarantee delivery order. Applying it would resurrect
      // the old plan and cancel the new (paid) one at the provider.
      if (sub.status === "canceled") {
        skipForeignEvent(event, "obsolete_activation");
        return;
      }

      await retireSuperseded(supabase, sub, {
        keepProvider: event.provider,
        keepProviderSubscriptionId: event.providerSubscriptionId,
      });

      // Whether this event opens a NEW billing cycle, or merely repeats one
      // that is already running (`lib/billing-window.ts`, unit-tested): both
      // directions cost money.
      const window = resolveBillingWindow(
        {
          status: sub.status,
          period: (sub.period as BillingPeriod | null) ?? null,
          currentPeriodStart: sub.current_period_start,
          currentPeriodEnd: sub.current_period_end,
        },
        { currentPeriodStart: event.currentPeriodStart, currentPeriodEnd: event.currentPeriodEnd },
      );

      const { error: activationError } = await supabase
        .from("subscriptions")
        .update({
          status: event.status,
          provider: event.provider,
          provider_customer_id: event.providerCustomerId ?? sub.provider_customer_id,
          provider_subscription_id: event.providerSubscriptionId,
          // Activation supersedes any open dunning window.
          past_due_since: null,
          current_period_start: window.start,
          current_period_end: window.end,
        })
        .eq("id", sub.id);
      if (activationError) throw new Error("subscription_reconciliation_failed");

      if (sub.status === "incomplete") {
        // The one celebratory moment of the funnel: with Pix the confirmation
        // lands after she left the app.
        await notifyPlanActive(supabase, sub.org_id, sub.plan_id);
        const plan = await readPlan(supabase, sub.plan_id);
        await trackWorkspaceEvent(
          supabase,
          sub.org_id,
          "subscription.started",
          isTierSlug(plan?.tier) ? { offer: plan.tier } : {},
        );
        await trackUpsellPurchase(supabase, sub.org_id, plan?.tier);
      }

      // Attach order-bump add-ons chosen at checkout (none are sold today).
      const moduleIds = (event.metadata.module_ids ?? "").split(",").filter(Boolean);
      for (const moduleId of moduleIds) {
        const { error: moduleError } = await supabase
          .from("subscription_modules")
          .upsert({ subscription_id: sub.id, module_id: moduleId }, { onConflict: "subscription_id,module_id" });
        if (moduleError) throw new Error("subscription_module_reconciliation_failed");
      }

      // Count the coupon's use once, on first activation. A failure throws:
      // the claim rolled back with it, so the retry counts it.
      if (event.metadata.coupon_id && sub.status === "incomplete") {
        await redeemCoupon(supabase, event.metadata.coupon_id, sub.id);
      }
      break;
    }

    case "subscription_canceled": {
      const { data: sub, error: subscriptionError } = await supabase
        .from("subscriptions")
        .select("id, org_id, plan_id, status, cancel_reason, cancellation_requested_at, plans(tier)")
        .eq("provider", event.provider)
        .eq("provider_subscription_id", event.providerSubscriptionId)
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .maybeSingle();
      if (subscriptionError) throw new Error("subscription_reconciliation_failed");
      if (!sub) return;
      // Only a row that is still live is ended here: the settlement job ends
      // the same subscriptions at the same moment, and whichever of the two
      // flips the row is the one that reports it and writes to the member.
      const { data: ended, error: cancellationError } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false })
        .eq("id", sub.id)
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .select("id");
      if (cancellationError) throw new Error("subscription_reconciliation_failed");
      await ensureFreeSubscription(supabase, sub.org_id);
      // A checkout that never paid was never a subscription to lose.
      if (sub.status !== "incomplete" && (ended ?? []).length > 0) {
        const tier = (sub.plans as unknown as { tier: string | null } | null)?.tier ?? null;
        await trackWorkspaceEvent(supabase, sub.org_id, "subscription.canceled", {
          ...(sub.cancel_reason ? { reason: sub.cancel_reason as string } : {}),
          ...(tier ? { tier_from: tier } : {}),
        });
        // Why it ended, as far as the row knows: a payment that never came, the
        // member's own request, or nothing on record (ended at the provider).
        await notifySubscriptionEnded(supabase, {
          orgId: sub.org_id,
          planId: sub.plan_id,
          cause: sub.status === "past_due" ? "payment" : sub.cancellation_requested_at ? "requested" : "ended",
        });
      }
      break;
    }

    case "payment_succeeded": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      // No local subscription AND no org in the provider's metadata: this
      // charge belongs to someone else's flow in the same Asaas account.
      if (!orgId) {
        skipForeignEvent(event, "no_billing_context");
        return;
      }

      // Asaas emits PAYMENT_CONFIRMED then PAYMENT_RECEIVED for the SAME card
      // payment. Reconciliation below is idempotent, but the analytics
      // Purchase must fire ONCE per invoice.
      const { data: priorInvoice } = await supabase
        .from("invoices")
        .select("status")
        .eq("provider", event.provider)
        .eq("provider_invoice_id", event.providerInvoiceId)
        .maybeSingle();
      const alreadyCounted = priorInvoice?.status === "paid";

      const { error: invoiceError } = await supabase.from("invoices").upsert(
        {
          org_id: orgId,
          subscription_id: sub?.id ?? null,
          provider: event.provider,
          provider_invoice_id: event.providerInvoiceId,
          amount_cents: event.amountCents,
          currency: event.currency,
          status: "paid",
          invoice_url: event.invoiceUrl,
          paid_at: event.paidAt.toISOString(),
        },
        { onConflict: "provider,provider_invoice_id" },
      );
      if (invoiceError) throw new Error("invoice_reconciliation_failed");

      const invoiceKey = `${event.provider}:${event.providerInvoiceId}`;
      const plan = await readPlan(supabase, event.metadata.plan_id ?? sub?.plan_id);

      // A one-time ACCESS purchase (the kit) is granted HERE, on the paid
      // invoice and never at checkout start. The grant is idempotent per
      // purchase, so a resent event grants nothing more, and a refunded kit is
      // never revived by a late replay (grant_entitlement_on_invoice, 0024).
      //
      // An access paid in installments is ONE purchase with a payment per
      // parcel: every parcel's event names the installment, the grant is keyed
      // by it, and twelve confirmed parcels grant one term. The parcel's own
      // amount is not what was sold; the whole is.
      let accessSoldCents: number | null = null;
      let accessSaleHere = false;
      let accessSplit = false;
      if (plan?.kind === "access") {
        accessSplit = Boolean(event.providerPaymentRef && event.providerPaymentRef !== event.providerInvoiceId);
        const purchaseRef = event.providerPaymentRef ?? event.providerInvoiceId;
        accessSoldCents = accessSplit
          ? await soldAccessPrice(supabase, plan, event.metadata.coupon_id)
          : event.amountCents;
        const { data: granted, error: grantError } = await supabase.rpc("grant_entitlement_on_invoice", {
          target_org: orgId,
          target_plan: plan.id,
          target_provider: event.provider,
          target_provider_invoice_id: purchaseRef,
          target_price_cents: accessSoldCents,
          target_currency: event.currency.toUpperCase(),
        });
        const grant = granted as { ok?: boolean; code?: string; grantId?: string } | null;
        if (grantError || !grant?.ok) throw new Error("grant_reconciliation_failed");
        accessSaleHere = grant.code === "granted";

        // The first delivery of a new grant is the purchase; a replay is not.
        // This block runs before anything below that may throw, because a
        // retry finds the grant already given and never comes back to it.
        if (accessSaleHere) {
          // Counted here or never: a retry finds the grant already given and
          // skips this block, so a failure is logged instead of replayed.
          if (event.metadata.coupon_id) {
            await redeemCoupon(supabase, event.metadata.coupon_id, null).catch((couponError) => {
              console.error("billing_kit_coupon_not_counted", {
                orgId,
                couponId: event.metadata.coupon_id,
                message: couponError instanceof Error ? couponError.message : String(couponError),
              });
            });
          }
          await trackWorkspaceEvent(supabase, orgId, "kit.purchased", { offer: "kit" }, event.paidAt);
          await trackUpsellPurchase(supabase, orgId, "kit", event.paidAt);
          await notifyAccessGranted(supabase, orgId, {
            planId: plan.id,
            grantId: grant.grantId ?? null,
            amountCents: accessSoldCents,
            currency: event.currency.toUpperCase(),
          });
        }

        if (!accessSplit) {
          // Idempotent per invoice (upsert, duplicates ignored): a failure here
          // throws and the retry writes it.
          await recordPurchaseAttribution(supabase, {
            orgId,
            invoiceKey,
            subscriptionId: null,
            planSlug: plan.slug,
            amountCents: event.amountCents,
            currency: event.currency.toUpperCase(),
            paidAt: event.paidAt,
          });
        } else if (accessSaleHere) {
          // One sale, credited once, by the parcel that granted it, at the
          // whole price. A retry finds the grant given and never returns here,
          // so a failure is logged instead of replayed.
          await recordPurchaseAttribution(supabase, {
            orgId,
            invoiceKey,
            subscriptionId: null,
            planSlug: plan.slug,
            amountCents: accessSoldCents,
            currency: event.currency.toUpperCase(),
            paidAt: event.paidAt,
          }).catch((attributionError) => {
            console.error("billing_split_attribution_failed", {
              orgId,
              invoiceKey,
              message: attributionError instanceof Error ? attributionError.message : String(attributionError),
            });
          });
        }
      }

      // A yearly plan split into installments is ONE purchase: no provider
      // subscription will ever emit an activation, so its first paid parcel
      // activates it here, for exactly one period, set not to renew
      // (docs/BILLING.md, installments). Before this, such a purchase was paid
      // and never activated.
      //
      // The card is authorized for the total, so Asaas confirms every parcel
      // within seconds, in parallel deliveries. Whichever handler flips the row
      // out of `incomplete` owns the SALE: the notice, the event, the campaign
      // credit and the ad-platform Purchase, all at the full price. Counting
      // paid invoices instead raced (two parcels each saw two) and reported a
      // sale per parcel.
      const singlePurchase = Boolean(sub) && sub?.renews === false;
      let saleOpenedHere = false;
      if (sub && sub.status === "incomplete" && singlePurchase) {
        await retireSuperseded(supabase, sub, { keepProvider: event.provider, keepProviderSubscriptionId: null });
        // No provider subscription will ever activate, so the coupon's use is
        // counted here, BEFORE the row leaves `incomplete`: a failure throws
        // with nothing flipped, and the retry (or a parallel parcel) finds the
        // use already claimed on the row.
        if (event.metadata.coupon_id) {
          await redeemCoupon(supabase, event.metadata.coupon_id, sub.id);
        }
        const start = event.paidAt;
        const end = periodEnd(start, (sub.period as BillingPeriod | null) ?? "yearly");
        const { data: flipped, error: activationError } = await supabase
          .from("subscriptions")
          .update({
            status: "active",
            past_due_since: null,
            current_period_start: start.toISOString(),
            current_period_end: end.toISOString(),
            // It ends when the period ends; the member buys again to continue.
            cancel_at_period_end: true,
          })
          .eq("id", sub.id)
          .eq("status", "incomplete")
          .select("id");
        if (activationError) throw new Error("subscription_reconciliation_failed");
        saleOpenedHere = (flipped ?? []).length > 0;
        // Everything below the flip is best-effort: a retry finds the row
        // active and never comes back here, so throwing would only lose it.
        if (saleOpenedHere) {
          await notifyPlanActive(supabase, sub.org_id, sub.plan_id);
          await trackWorkspaceEvent(
            supabase,
            sub.org_id,
            "subscription.started",
            isTierSlug(plan?.tier) ? { offer: plan.tier } : {},
            event.paidAt,
          );
          await trackUpsellPurchase(supabase, sub.org_id, plan?.tier, event.paidAt);
        }
      }
      // What the sale is worth: the whole purchase for a split one (the price
      // snapshot, or the access rebuilt above), the charge itself otherwise.
      const saleCents =
        accessSoldCents ??
        (singlePurchase && typeof sub?.price_cents === "number" ? (sub.price_cents as number) : event.amountCents);

      // A paid invoice heals a past_due subscription — and closes the dunning
      // window with it, so a later failure starts counting from scratch.
      if (sub && sub.status === "past_due") {
        const { error: recoveryError } = await supabase
          .from("subscriptions")
          .update({ status: "active", past_due_since: null })
          .eq("id", sub.id);
        if (recoveryError) throw new Error("subscription_reconciliation_failed");
        await notifyPaymentRecovered(supabase, orgId);
      }

      // Purchases per campaign: only the invoice that STARTS a subscription
      // counts (the kit was credited above; a split purchase, by its opener).
      if (sub && singlePurchase) {
        if (saleOpenedHere) {
          await recordPurchaseAttribution(supabase, {
            orgId,
            invoiceKey,
            subscriptionId: sub.id,
            planSlug: plan?.slug ?? null,
            amountCents: saleCents,
            currency: event.currency.toUpperCase(),
            paidAt: event.paidAt,
          }).catch((attributionError) => {
            console.error("billing_split_attribution_failed", {
              orgId,
              invoiceKey,
              message: attributionError instanceof Error ? attributionError.message : String(attributionError),
            });
          });
        }
      } else if (sub) {
        const { count: paidCount, error: countError } = await supabase
          .from("invoices")
          .select("id", { count: "exact", head: true })
          .eq("subscription_id", sub.id)
          .eq("status", "paid");
        if (countError) throw new Error("purchase_attribution_failed");
        if (paidCount === 1) {
          await recordPurchaseAttribution(supabase, {
            orgId,
            invoiceKey,
            subscriptionId: sub.id,
            planSlug: plan?.slug ?? null,
            amountCents: event.amountCents,
            currency: event.currency.toUpperCase(),
            paidAt: event.paidAt,
          });
        }
      }

      // Meta CAPI + GA4 — Purchase, once per paid invoice (renewals are distinct
      // invoices, so they count as distinct purchases), and once per SALE for a
      // split purchase, subscription or access. Best-effort: it never blocks
      // reconciliation.
      if (!alreadyCounted && (!singlePurchase || saleOpenedHere) && (!accessSplit || accessSaleHere))
        try {
          const { data: attribution } = await supabase
            .from("meta_attribution")
            .select(
              "fbp, fbc, email, client_ip, client_user_agent, ga_client_id, campaign_origem, campaign_utm_source, campaign_utm_medium, campaign_utm_campaign, campaign_utm_content",
            )
            .eq("org_id", orgId)
            .maybeSingle();
          // The LAST touch — the campaign of the checkout that produced this sale.
          const lastTouch: Record<string, string> = {};
          if (attribution?.campaign_origem) lastTouch.last_origem = attribution.campaign_origem;
          if (attribution?.campaign_utm_source) lastTouch.last_utm_source = attribution.campaign_utm_source;
          if (attribution?.campaign_utm_medium) lastTouch.last_utm_medium = attribution.campaign_utm_medium;
          if (attribution?.campaign_utm_campaign) lastTouch.last_utm_campaign = attribution.campaign_utm_campaign;
          if (attribution?.campaign_utm_content) lastTouch.last_utm_content = attribution.campaign_utm_content;
          const campaign = await readSignupAttribution(orgId);
          const planFacts: Record<string, string | number> = {};
          if (sub?.period) planFacts.billing_cycle = sub.period;
          if (plan?.slug) planFacts.plan = plan.slug;
          if (sub?.coupon_id) {
            const { data: couponRow } = await supabase
              .from("coupons")
              .select("code")
              .eq("id", sub.coupon_id)
              .maybeSingle();
            if (couponRow?.code) planFacts.coupon = couponRow.code;
          }
          await sendMetaConversion({
            eventName: "Purchase",
            eventId: invoiceKey,
            externalId: orgId,
            email: attribution?.email ?? null,
            fbp: attribution?.fbp ?? null,
            fbc: attribution?.fbc ?? null,
            clientIp: attribution?.client_ip ?? null,
            clientUserAgent: attribution?.client_user_agent ?? null,
            value: saleCents / 100,
            currency: event.currency,
            customData: { ...campaign, ...lastTouch, ...planFacts },
            actionSource: "system_generated",
            eventTime: Math.floor(event.paidAt.getTime() / 1000),
          });
          await sendGa4Event({
            clientId: attribution?.ga_client_id ?? null,
            eventName: "purchase",
            eventId: invoiceKey,
            eventTime: Math.floor(event.paidAt.getTime() / 1000),
            params: {
              currency: event.currency,
              value: saleCents / 100,
              transaction_id: invoiceKey,
            },
          });

          // Subscribe, ONCE per subscription: only on its FIRST paid invoice
          // (renewals stay Purchase), or by the opener of a split purchase. The
          // kit has no subscription and skips it.
          if (sub) {
            const { count: paidInvoices } = singlePurchase
              ? { count: saleOpenedHere ? 1 : 0 }
              : await supabase
                  .from("invoices")
                  .select("id", { count: "exact", head: true })
                  .eq("subscription_id", sub.id)
                  .eq("status", "paid");
            if (paidInvoices === 1) {
              await sendMetaConversion({
                eventName: "Subscribe",
                eventId: `subscribe:${sub.id}`,
                externalId: orgId,
                email: attribution?.email ?? null,
                fbp: attribution?.fbp ?? null,
                fbc: attribution?.fbc ?? null,
                clientIp: attribution?.client_ip ?? null,
                clientUserAgent: attribution?.client_user_agent ?? null,
                value: saleCents / 100,
                currency: event.currency,
                actionSource: "system_generated",
                eventTime: Math.floor(event.paidAt.getTime() / 1000),
              });
              await sendGa4Event({
                clientId: attribution?.ga_client_id ?? null,
                eventName: "subscribe",
                eventId: `subscribe:${sub.id}`,
                eventTime: Math.floor(event.paidAt.getTime() / 1000),
                params: { currency: event.currency, value: saleCents / 100 },
              });
            }
          }
        } catch {
          // Measurement is best-effort — a paid invoice is already reconciled.
        }
      break;
    }

    case "payment_failed": {
      const sub = await findSubscription(supabase, event);
      const orgId = sub?.org_id ?? event.metadata.org_id;
      if (!orgId) {
        skipForeignEvent(event, "no_billing_context");
        return;
      }
      const { error: invoiceError } = await supabase.from("invoices").upsert(
        {
          org_id: orgId,
          subscription_id: sub?.id ?? null,
          provider: event.provider,
          provider_invoice_id: event.providerInvoiceId,
          amount_cents: event.amountCents,
          currency: event.currency,
          status: "failed",
          // The recovery link. Persisting it is what turns "update your
          // payment" from a dead end into an action she can actually take.
          invoice_url: event.invoiceUrl,
        },
        { onConflict: "provider,provider_invoice_id" },
      );
      if (invoiceError) throw new Error("invoice_reconciliation_failed");
      if (sub && ["trialing", "active"].includes(sub.status)) {
        // The window has to count from a moment the database owns.
        const { error: pastDueError } = await supabase
          .from("subscriptions")
          .update({ status: "past_due", past_due_since: new Date().toISOString() })
          .eq("id", sub.id);
        if (pastDueError) throw new Error("subscription_reconciliation_failed");

        await notifyPaymentFailed(supabase, orgId, await graceDays(supabase));
      }
      break;
    }

    case "payment_reverted": {
      // Money that came back. The invoice stops reading as paid, and what it
      // BOUGHT goes with it: revert_paid_invoice revokes the kit's grant.
      const { data, error } = await supabase.rpc("revert_paid_invoice", {
        target_provider: event.provider,
        target_provider_invoice_id: event.providerInvoiceId,
        target_kind: event.kind,
        // The grant of an access paid in parts is keyed by the installment the
        // refunded parcel belongs to (0024).
        target_purchase_ref: event.providerPaymentRef ?? null,
      });
      if (error) throw new Error("invoice_reversal_failed");
      const result = data as { ok?: boolean; code?: string; orgId?: string; grantsRevoked?: number } | null;
      if (result?.ok !== true) throw new Error("invoice_reversal_failed");
      // An invoice we never recorded is not ours; the RPC says so and we stop.
      if (result.code === "unknown_invoice") {
        skipForeignEvent(event, "unknown_invoice");
        break;
      }
      // A refunded kit ends the access it granted.
      if (result.code === "reverted" && result.orgId && Number(result.grantsRevoked) > 0) {
        const owner = await workspaceOwner(supabase, result.orgId);
        await logAuditEvent(supabase, {
          orgId: result.orgId,
          actorId: null,
          action: "billing.grant_reverted",
          entityType: "invoice",
          entityId: event.providerInvoiceId,
          metadata: { provider: event.provider, kind: event.kind, owner },
        }).catch(() => {
          // The reversal is already in the database.
        });
      }
      // A refunded split purchase ends now: no provider subscription exists
      // whose cancellation would end it later.
      if (result.code === "reverted") {
        await endRefundedSinglePurchase(supabase, event);
      }
      break;
    }
  }
}

/**
 * Claims one event, reconciles it and closes the claim.
 *
 * Returns true when the provider SHOULD resend it (a genuine race worth
 * retrying), false when there is nothing more to gain from a redelivery.
 */
async function processEvent(supabase: ServiceClient, event: BillingEvent): Promise<boolean> {
  const { data: claimData, error: claimError } = await supabase.rpc("claim_billing_webhook_event", {
    target_provider: event.provider,
    target_provider_event_id: event.providerEventId,
    target_event_type: event.type,
  });
  const claim = claimData as {
    ok?: boolean;
    code?: string;
    eventId?: string;
    claimToken?: string;
    attempts?: number;
  } | null;
  if (claim?.code === "already_processed") return false;
  // Another invocation owns this event inside its lease. Answering 500 here
  // penalizes the provider's queue for doing nothing wrong.
  if (claim?.code === "event_in_progress") return false;
  if (claimError || !claim?.ok || !claim.eventId || !claim.claimToken) return true;

  try {
    await handleEvent(supabase, event);
    const { data: completionData, error: completionError } = await supabase.rpc("complete_billing_webhook_event", {
      target_event: claim.eventId,
      target_claim_token: claim.claimToken,
      target_success: true,
      target_error_code: null,
    });
    const completion = completionData as { ok?: boolean } | null;
    return Boolean(completionError) || completion?.ok !== true;
  } catch (error) {
    // After enough tries the problem is ours, not a race: keep answering 200
    // so the provider's queue survives, and hand the replay to an operator.
    const attempts = Number(claim.attempts ?? 1);
    const permanent = attempts >= MAX_HANDLER_ATTEMPTS;
    console.error("billing_webhook_handler_failed", {
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.type,
      attempts,
      permanent,
      message: error instanceof Error ? error.message : String(error),
    });
    const { data: completionData, error: completionError } = await supabase.rpc("complete_billing_webhook_event", {
      target_event: claim.eventId,
      target_claim_token: claim.claimToken,
      target_success: false,
      target_error_code: permanent ? "handler_failed_permanent" : "handler_failed",
    });
    const completion = completionData as { ok?: boolean } | null;
    if (completionError || completion?.ok !== true) {
      console.warn("billing_webhook_claim_completion_failed", {
        provider: event.provider,
        eventType: event.type,
      });
    }
    return !permanent;
  }
}

/**
 * `after()` keeps running once the response is sent, but only until the
 * function itself is torn down — so the deferred pass needs headroom the
 * platform default does not give it.
 */
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerName } = await params;
  // ONE bills through Asaas alone.
  if (providerName !== "asaas") {
    return new NextResponse("Unknown provider", { status: 404 });
  }

  let rawBody: string;
  let supabase: ServiceClient;
  try {
    // `createServiceClient()` throws when its env vars are missing; inside the
    // try it is logged instead of producing a silent 500.
    rawBody = await request.text();
    supabase = createServiceClient();
  } catch (error) {
    console.error("billing_webhook_bootstrap_failed", {
      provider: providerName,
      message: error instanceof Error ? error.message : String(error),
    });
    return new NextResponse("Webhook unavailable", { status: 503 });
  }

  let events: BillingEvent[];
  try {
    events = await getProvider("asaas").parseWebhook(rawBody, {
      "asaas-access-token": request.headers.get("asaas-access-token"),
    });
  } catch {
    console.warn("billing_webhook_rejected", { provider: providerName });
    return new NextResponse("Invalid webhook", { status: 400 });
  }

  let failed = false;
  const startedAt = Date.now();
  /** Events the inline budget ran out on; finished after the response. */
  const deferred: BillingEvent[] = [];

  for (const event of events) {
    if (Date.now() - startedAt > INLINE_BUDGET_MS) {
      deferred.push(event);
      continue;
    }
    if (await processEvent(supabase, event)) failed = true;
  }

  // Whatever did not fit the budget finishes after the response is sent. A
  // failure here stays in the inbox with its attempt count for an operator.
  if (deferred.length > 0) {
    after(async () => {
      for (const event of deferred) {
        try {
          await processEvent(supabase, event);
        } catch (error) {
          console.error("billing_webhook_deferred_failed", {
            provider: event.provider,
            providerEventId: event.providerEventId,
            eventType: event.type,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
  }

  return NextResponse.json({ received: !failed }, { status: failed ? 500 : 200 });
}
