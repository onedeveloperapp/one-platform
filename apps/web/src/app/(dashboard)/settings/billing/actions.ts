"use server";

import {
  type ActiveBillingClaim,
  appOrigin,
  failBillingClaim,
  loadPayer,
  logBillingFailure,
  orgOwnerId,
  providerFailureCode,
  purchaseBlockedReason,
  requireOrgManager,
  UUID,
} from "./billing-server";
import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { recordAudit } from "@/lib/audit";
import { getMaxInstallments } from "@/lib/billing-settings";
import { type CampaignParams, decodeCampaignCookie, hasCampaign, pickCampaignParams } from "@/lib/campaign-params";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { normalizeCouponCode } from "@/lib/offer-link";
import { resolvePaymentChoice } from "@/lib/payment-choice";
import { pendingPixCharge } from "@/lib/pending-pix";
import { trackServerEvent } from "@/lib/product-events-server";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import {
  applyDiscount,
  type CheckoutPlan,
  getProvider,
  isTier,
  type PaymentMethod,
  type PixCharge,
  providerForCurrency,
} from "@flyee/billing";

export type StartCheckoutResult = {
  url?: string;
  error?: string;
  /**
   * PIX rendered on our page. Absent when the method is not PIX, when the
   * provider has no PIX, or when the QR could not be read — in every case the
   * caller falls back to `url`, the hosted invoice, which shows the same QR.
   */
  pix?: PixCharge;
};

export type AppliedCoupon = {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  currency: string | null;
};

type AppliedCouponRow = {
  id: string;
  code: string;
  discount_type: "percent" | "fixed";
  discount_value: number;
  currency: string | null;
};

/**
 * Resolves a campaign code the customer typed (or arrived with) into the
 * discount the providers will actually apply.
 *
 * `validate_coupon` is a SECURITY DEFINER function precisely so this can happen
 * without exposing the coupons table: an invalid, expired or exhausted code is
 * indistinguishable from a code that never existed. With a plan it also checks
 * the code applies to that plan's family and, for a fixed amount, its currency.
 *
 * Checked here, BEFORE the payment page, because the alternative is finding out
 * at the provider — and an audience that was promised a discount would be
 * looking at the full price with no explanation.
 */
export async function validateCouponCode(
  code: string,
  planId?: string | null,
): Promise<{ coupon?: AppliedCoupon; error?: "coupon_invalid" | "unavailable" }> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { error: "coupon_invalid" };
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "unavailable" };
    const { data, error } = await supabase.rpc("validate_coupon", {
      coupon_code: normalized,
      ...(planId && UUID.test(planId) ? { target_plan: planId } : {}),
    });
    if (error) {
      logBillingFailure("coupon_validation_failed", { code: normalized }, error);
      return { error: "unavailable" };
    }
    const row = (data as AppliedCouponRow[] | null)?.[0];
    if (!row) return { error: "coupon_invalid" };
    return {
      coupon: {
        id: row.id,
        code: row.code,
        discountType: row.discount_type,
        discountValue: row.discount_value,
        currency: row.currency,
      },
    };
  } catch {
    return { error: "unavailable" };
  }
}

/**
 * Whether plans in this currency can be sold in this deployment (its provider
 * is configured), and the most card installments the checkout offers in it
 * (reais only; 1 means none), so the plans read what the checkout will offer.
 */
export async function checkoutAvailability(currency: string): Promise<{ available: boolean; maxInstallments: number }> {
  const available = providerForCurrency(currency) !== null;
  const maxInstallments = available && currency.trim().toUpperCase() === "BRL" ? await getMaxInstallments() : 1;
  return { available, maxInstallments };
}

/**
 * The complete set of places a checkout may return to. Adding a destination
 * means adding it here, which is the point: the provider only ever receives a
 * path this file wrote.
 */
const CHECKOUT_RETURN = { billing: "/settings/billing", home: "/inicio" } as const;

/**
 * Starts a purchase: a subscription (club, Pro) or the one-time kit
 * (docs/BILLING.md).
 *
 * The plan's currency picks the provider (BRL Asaas, USD Stripe), and only
 * Asaas needs the payer's CPF/CNPJ. A subscription writes its pending row now,
 * with the price, currency and coupon it was SOLD at (the snapshot that later
 * price edits never touch); the kit writes nothing but the operation, because
 * its right is granted by the webhook on the paid invoice, never here.
 */
export async function startCheckout(input: {
  orgId: string;
  planId: string;
  idempotencyKey: string;
  /** Campaign code, if she typed one or arrived with `?cupom=`. */
  couponCode?: string | null;
  /** Chosen in our checkout (BRL only), so the provider never offers boleto. */
  paymentMethod?: PaymentMethod | null;
  /** Card installments; clamped and re-checked server-side. */
  installments?: number | null;
  /**
   * Where the provider sends her back. A KEY, never a URL: this value crosses
   * from the browser into the string we hand the payment provider, so a path
   * would be an open redirect sitting in the checkout.
   */
  returnTo?: keyof typeof CHECKOUT_RETURN;
  /**
   * The campaign of THIS purchase (last touch), forwarded from the landing
   * link. Re-validated here — it crossed the browser — and stored in
   * meta_attribution for the purchase (lib/campaign-params.ts).
   */
  campaign?: CampaignParams | null;
}): Promise<StartCheckoutResult> {
  let activeClaim: ActiveBillingClaim | null = null;
  try {
    const { supabase, user } = await requireOrgManager(input.orgId);
    if (!UUID.test(input.idempotencyKey)) {
      logBillingFailure("invalid_idempotency_key", { orgId: input.orgId });
      return { error: "unavailable" };
    }

    const blocked = await purchaseBlockedReason(supabase, input.orgId);
    if (blocked) {
      logBillingFailure("purchase_blocked", { orgId: input.orgId, reason: blocked });
      return { error: blocked };
    }

    const [{ data: planRow }, { orgName, payer }, maxInstallments] = await Promise.all([
      supabase.from("plans").select("*").eq("id", input.planId).eq("is_active", true).single(),
      loadPayer(supabase, input.orgId),
      getMaxInstallments(),
    ]);
    if (!planRow || planRow.is_free || planRow.is_addon) {
      logBillingFailure("plan_not_purchasable", { orgId: input.orgId, planId: input.planId, found: Boolean(planRow) });
      return { error: "unavailable" };
    }
    const isAccess = planRow.kind === "access";

    // The currency decides the provider. A currency whose provider is not
    // configured here is not on sale, and the money is never rerouted.
    const provider = providerForCurrency(planRow.currency);
    if (!provider) {
      logBillingFailure("currency_unavailable", { orgId: input.orgId, currency: planRow.currency });
      return { error: "currency_unavailable" };
    }
    // Asaas rejects a customer without cpfCnpj, so this would fail deep inside
    // the provider call with a generic message. Named here, the UI can send
    // her to the form that fixes it instead of "try again later".
    if (provider === "asaas" && !payer.document) {
      logBillingFailure("missing_billing_document", { orgId: input.orgId });
      return { error: "billing_profile_required" };
    }

    // A code that no longer works STOPS the checkout. Dropping it silently and
    // charging the table price is the one outcome she would never forgive.
    let coupon: AppliedCoupon | undefined;
    if (normalizeCouponCode(input.couponCode)) {
      const validated = await validateCouponCode(input.couponCode ?? "", planRow.id);
      if (!validated.coupon) {
        logBillingFailure("coupon_rejected", { orgId: input.orgId, reason: validated.error });
        return { error: validated.error ?? "coupon_invalid" };
      }
      coupon = validated.coupon;
    }

    const plan: CheckoutPlan = {
      id: planRow.id,
      slug: planRow.slug,
      name: planRow.name,
      kind: planRow.kind,
      period: planRow.period,
      priceCents: planRow.price_cents,
      currency: planRow.currency,
      trialDays: Math.max(0, Number(planRow.trial_days) || 0),
      description: planRow.description ?? null,
    };

    // A PIX already waiting for THIS subscription plan is returned, never
    // duplicated: a reload or a second tab used to mint a fresh key and with
    // it a SECOND recurring subscription at the provider.
    if (!isAccess && input.paymentMethod === "pix") {
      const waiting = await pendingPixCharge(supabase, input.orgId, input.planId);
      if (waiting?.invoiceUrl) return { url: waiting.invoiceUrl, pix: waiting };
    }

    const service = createServiceClient();
    const { data: claimData, error: claimError } = await service.rpc("claim_billing_operation", {
      target_org: input.orgId,
      target_actor: user.id,
      target_kind: isAccess ? "access_checkout" : "checkout",
      target_idempotency_key: input.idempotencyKey,
      target_provider: provider,
      target_plan: plan.id,
      target_subscription: null,
    });
    const claim = claimData as {
      ok?: boolean;
      code?: string;
      operationId?: string;
      claimToken?: string;
      result?: { url?: string };
    } | null;
    if (claim?.code === "completed" && claim.result?.url) {
      // A double click, or a retry with the same key, replays the stored
      // result — which holds only the url. The QR is not our state, it is a
      // read of the charge, so a subscription's is read again.
      const replayPix =
        !isAccess && input.paymentMethod === "pix" ? await pendingPixCharge(supabase, input.orgId, input.planId) : null;
      return { url: claim.result.url, ...(replayPix ? { pix: replayPix } : {}) };
    }
    if (claimError || !claim?.ok || !claim.operationId || !claim.claimToken) {
      logBillingFailure("claim_rejected", { orgId: input.orgId, provider, code: claim?.code }, claimError);
      return { error: "unavailable" };
    }
    activeClaim = { service, operationId: claim.operationId, claimToken: claim.claimToken };

    const origin = await appOrigin();
    const choice = resolvePaymentChoice({
      planKind: planRow.kind,
      method: input.paymentMethod,
      installments: input.installments,
      planPeriod: planRow.period,
      currency: planRow.currency,
      maxInstallments,
    });
    const returnPath = CHECKOUT_RETURN[input.returnTo ?? "billing"];
    const result = await getProvider(provider).createCheckout({
      idempotencyKey: input.idempotencyKey,
      orgId: input.orgId,
      orgName,
      customerEmail: user.email ?? "",
      plan,
      modules: [],
      paymentMethod: choice.method,
      installments: choice.installments,
      coupon,
      payer,
      // Resolved from a fixed map, so the only paths that can ever reach the
      // provider are the ones listed there.
      successUrl: `${origin}${returnPath}?checkout=success`,
      cancelUrl: `${origin}${returnPath}?checkout=canceled`,
    });

    let completedUrl: string | undefined;
    if (isAccess) {
      const { data: completedData, error: completeError } = await service.rpc(
        "complete_access_checkout_billing_operation",
        {
          target_operation: claim.operationId,
          target_claim_token: claim.claimToken,
          target_plan: plan.id,
          target_checkout_url: result.url,
        },
      );
      const completed = completedData as { ok?: boolean; result?: { url?: string } } | null;
      if (completeError || !completed?.ok) {
        logBillingFailure("local_reconciliation_failed", { orgId: input.orgId, planId: input.planId }, completeError);
        await failBillingClaim(activeClaim, "local_reconciliation_failed");
        activeClaim = null;
        return { error: "unavailable" };
      }
      completedUrl = completed.result?.url;
    } else {
      // The price she is SOLD at, kept on the subscription: edits to the plan
      // later never change what an existing subscriber pays (docs/BILLING.md,
      // price lock). A coupon that rides every cycle is part of that price.
      const { data: completedData, error: pendingError } = await service.rpc("complete_checkout_billing_operation", {
        target_operation: claim.operationId,
        target_claim_token: claim.claimToken,
        target_plan: plan.id,
        target_period: plan.period,
        target_provider_customer: result.providerCustomerId ?? null,
        target_provider_subscription: result.providerSubscriptionId ?? null,
        target_checkout_url: result.url,
        target_price_cents: applyDiscount(plan.priceCents, coupon),
        target_currency: plan.currency,
        target_coupon_code: coupon?.code ?? null,
        // A yearly plan split into installments is ONE purchase, not a
        // subscription: it never renews by itself, and the webhook activates
        // it by this payment reference (docs/BILLING.md, installments).
        target_provider_payment: result.providerSubscriptionId ? null : (result.providerPaymentId ?? null),
        target_renews: Boolean(result.providerSubscriptionId) || !result.providerPaymentId,
      });
      const completed = completedData as { ok?: boolean; result?: { url?: string } } | null;
      if (pendingError || !completed?.ok) {
        // The provider already has a checkout at this point; only the local
        // bookkeeping failed. Worth shouting about — the customer may be
        // looking at a payment page we have no record of.
        logBillingFailure("local_reconciliation_failed", { orgId: input.orgId, planId: input.planId }, pendingError);
        await failBillingClaim(activeClaim, "local_reconciliation_failed");
        activeClaim = null;
        return { error: "unavailable" };
      }
      completedUrl = completed.result?.url;

      // A PIX opens the provisional window: she can use the plan while the
      // bank confirms, once per workspace, for the configured hours. Best
      // effort — failing to mark it costs her the window, not the purchase.
      if (choice.method === "pix" && result.providerSubscriptionId) {
        const { error: markError } = await service.rpc("mark_pix_checkout", {
          target_org: input.orgId,
          target_provider_subscription: result.providerSubscriptionId,
        });
        if (markError) logBillingFailure("pix_mark_failed", { orgId: input.orgId }, markError);
      }
    }
    activeClaim = null;

    await recordAudit(supabase, isAccess ? "kit.checkout_started" : "subscription.checkout_started", {
      orgId: input.orgId,
      entityType: "plan",
      entityId: plan.id,
      metadata: { currency: plan.currency, provider },
    });

    // Measurement is best-effort and MUST NOT turn a successful checkout into
    // an error — hence its own try/catch, isolated from the outer handler.
    try {
      const actor = (await orgOwnerId(service, input.orgId)) ?? user.id;
      await trackServerEvent({
        actorId: actor,
        orgId: input.orgId,
        event: "checkout.started",
        properties: isTier(planRow.tier) ? { offer: planRow.tier } : {},
      });

      // Server-side (no Pixel runs on the app); reuses the request's _fbp/_fbc
      // (set by the public site, same origin) so it attributes to the ad click.
      const metaContext = await getMetaClientContext(`${origin}/settings/billing`);
      const gaClientId = await getGaClientId();
      // Stash the tracking signals so the browserless purchase webhook can
      // match on them later (PIX confirms out of band; renewals too). Only when
      // a signal exists, so a plain checkout never wipes a stored row.
      if (metaContext.fbp || metaContext.fbc || gaClientId) {
        await service.from("meta_attribution").upsert({
          org_id: input.orgId,
          fbp: metaContext.fbp ?? null,
          fbc: metaContext.fbc ?? null,
          email: user.email ?? null,
          client_ip: metaContext.clientIp ?? null,
          client_user_agent: metaContext.clientUserAgent ?? null,
          ga_client_id: gaClientId,
          updated_at: new Date().toISOString(),
        });
      }
      // The campaign of THIS purchase: the link of this checkout first; without
      // one, the last campaign link she followed (middleware cookie, 14 days).
      const linkCampaign = pickCampaignParams(input.campaign);
      const campaign = hasCampaign(linkCampaign)
        ? linkCampaign
        : decodeCampaignCookie((await cookies()).get(COOKIE_KEYS.lastCampaign)?.value);
      if (hasCampaign(campaign)) {
        await service.from("meta_attribution").upsert({
          org_id: input.orgId,
          campaign_origem: campaign.origem ?? null,
          campaign_utm_source: campaign.utm_source ?? null,
          campaign_utm_medium: campaign.utm_medium ?? null,
          campaign_utm_campaign: campaign.utm_campaign ?? null,
          campaign_utm_content: campaign.utm_content ?? null,
          campaign_captured_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        // A checkout that came from no campaign IS the last touch: it clears
        // the one before, or a sale weeks after a campaign would be credited
        // to it. An update, never an insert: no row is created for this.
        await service
          .from("meta_attribution")
          .update({
            campaign_origem: null,
            campaign_utm_source: null,
            campaign_utm_medium: null,
            campaign_utm_campaign: null,
            campaign_utm_content: null,
            campaign_captured_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("org_id", input.orgId)
          .not("campaign_captured_at", "is", null);
      }
      await sendMetaConversion({
        eventName: "InitiateCheckout",
        eventId: input.idempotencyKey,
        email: user.email,
        externalId: input.orgId,
        value: plan.priceCents / 100,
        currency: plan.currency,
        ...metaContext,
      });
      await sendGa4Event({
        clientId: gaClientId,
        eventName: "begin_checkout",
        eventId: input.idempotencyKey,
        params: { currency: plan.currency, value: plan.priceCents / 100 },
      });
    } catch {
      // Best-effort — the checkout URL returned below is what matters.
    }

    return { url: completedUrl ?? result.url, ...(result.pix ? { pix: result.pix } : {}) };
  } catch (error) {
    // The provider call is the likeliest thing to land here, and its message
    // is the only place the real cause exists.
    logBillingFailure("provider_call_threw", { orgId: input.orgId, planId: input.planId }, error);
    await failBillingClaim(activeClaim, providerFailureCode(error));
    // Pix was offered because the account has an active Pix key, but the
    // provider may still refuse the METHOD on this endpoint. That refusal is
    // the one failure the customer can route around in a single tap.
    if (input.paymentMethod === "pix" && (error as { code?: string } | null)?.code === "invalid_billingType") {
      return { error: "pix_unavailable" };
    }
    return { error: "unavailable" };
  }
}
