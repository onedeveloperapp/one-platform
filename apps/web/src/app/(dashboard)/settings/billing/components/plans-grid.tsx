"use client";

import { type AppliedCoupon, validateCouponCode } from "../actions";
import type { PlanRow, SubscriptionInfo, WorkspaceEntitlements } from "./use-billing";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Grid,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

import { COOKIE_KEYS } from "@/constants";
import NiCheck from "@/icons/nexture/ni-check";
import { accessTermParts } from "@/lib/access-term";
import { splitInstallments } from "@/lib/installments";
import { clearCouponCookie, normalizeCouponCode, readCouponCookie, writeCouponCookie } from "@/lib/offer-link";
import { type OfferKind, trackOffer } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { type BillingCurrency, formatPrice } from "@flyee/billing/currency";
import { enabledFeatures, type EntitlementKey, limitOf } from "@flyee/billing/entitlements";
import { applyDiscount } from "@flyee/billing/types";

/** The plural-aware key of a term ("1 ano", "18 meses"); both literals, so the message pruner sees them. */
const termKey = (months: number) =>
  accessTermParts(months).unit === "years" ? "access-term-years" : "access-term-months";

type Period = "monthly" | "yearly";

/** The recurring rungs, in ladder order. The kit (a one-time access plan) leads. */
const RECURRING_FAMILIES = ["club", "pro"] as const;

const OTHER_CURRENCY: Record<BillingCurrency, BillingCurrency> = { BRL: "USD", USD: "BRL" };

/** The on/off rights; devices are a count, rendered apart. */
type FeatureKey = Exclude<EntitlementKey, "devices">;

/** What each on/off right reads as on a card. */
const FEATURE_LABEL: Record<FeatureKey, string> = {
  catalog_access: "billing-feature-catalog_access",
  advanced_lessons: "billing-feature-advanced_lessons",
  recipes: "billing-feature-recipes",
  roadmap_vote: "billing-feature-roadmap_vote",
  meetings: "billing-feature-meetings",
  commercial_license: "billing-feature-commercial_license",
  open_the_hood: "billing-feature-open_the_hood",
};

/**
 * The ladder on the billing screen (docs/BILLING.md): the one-time kit, then
 * the subscription and Pro, monthly or yearly, in the member's currency.
 * Buying always continues on the focused checkout (`/assinatura?plan=`), the
 * one place that asks for the fiscal data and the payment method; this grid
 * only chooses. Phase 5 rebuilds the screen around the member's rung.
 */
export default function PlansGrid({
  subscription,
  plans,
  currency,
  onCurrencyChange,
  entitlements,
  canManage,
  checkoutAvailable,
  maxInstallments = 1,
  offerSlug,
}: {
  subscription: SubscriptionInfo | null;
  plans: PlanRow[];
  currency: BillingCurrency;
  onCurrencyChange: (currency: BillingCurrency) => void;
  entitlements: WorkspaceEntitlements;
  canManage: boolean;
  checkoutAvailable: boolean;
  /** The most card installments the checkout offers in this currency (1 = none). */
  maxInstallments?: number;
  /**
   * Plan slug she arrived with (`?plan=`) — the offer agreed on a call. It is
   * shown even when the plan is unlisted, highlighted and scrolled to, so the
   * link she was sent lands on the thing it promised.
   */
  offerSlug?: string | null;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const formatDate = (value: string) => new Intl.DateTimeFormat(locale).format(new Date(value));
  const router = useRouter();
  const [confirming, setConfirming] = useState<PlanRow | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const [couponInput, setCouponInput] = useState("");
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponError, setCouponError] = useState<"coupon_invalid" | "unavailable" | "link_invalid" | null>(null);
  const promptViewed = useRef(false);
  const offerRef = useRef<HTMLDivElement | null>(null);

  const paidPlans = useMemo(() => plans.filter((plan) => !plan.isFree), [plans]);
  const currentPlan = paidPlans.find((plan) => plan.id === subscription?.planId) ?? null;
  const offerPlan = offerSlug ? (paidPlans.find((plan) => plan.slug === offerSlug) ?? null) : null;
  // A link to an offer that ended must SAY so; rendering the ordinary grid
  // instead would look like the offer never existed.
  const offerMissing = Boolean(offerSlug) && !offerPlan;

  const [period, setPeriod] = useState<Period>(() =>
    currentPlan?.period === "yearly" || offerPlan?.period === "yearly" ? "yearly" : "monthly",
  );

  const inCurrency = paidPlans.filter((plan) => plan.currency === currency && plan.isPublic);
  const kitPlan = inCurrency.find((plan) => plan.kind === "access" && plan.family === "kit") ?? null;
  const familyPlan = (family: string, wanted: Period) =>
    inCurrency.find((plan) => plan.kind === "recurring" && plan.family === family && plan.period === wanted) ?? null;
  const recurringPlans = RECURRING_FAMILIES.map((family) => familyPlan(family, period)).filter(
    (plan): plan is PlanRow => plan !== null,
  );
  // The yearly saving, from real prices, for the toggle label.
  const savings = RECURRING_FAMILIES.map((family) => {
    const monthly = familyPlan(family, "monthly");
    const yearly = familyPlan(family, "yearly");
    if (!monthly || !yearly || monthly.priceCents <= 0) return 0;
    return Math.round((1 - yearly.priceCents / (monthly.priceCents * 12)) * 100);
  }).filter((value) => value > 0);
  const yearlySaving = savings.length > 0 ? Math.min(...savings) : 0;

  const shownPlans = [
    ...(offerPlan && offerPlan.id !== kitPlan?.id && !recurringPlans.some((plan) => plan.id === offerPlan.id)
      ? [offerPlan]
      : []),
    ...(kitPlan ? [kitPlan] : []),
    ...recurringPlans,
  ];

  useEffect(() => {
    if (!canManage || shownPlans.length === 0 || promptViewed.current) return;
    promptViewed.current = true;
    trackOffer("upsell.viewed", "billing");
  }, [canManage, shownPlans.length]);

  const offerPlanId = offerPlan?.id ?? null;
  useEffect(() => {
    const node = offerRef.current;
    if (!offerPlanId || !node) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [offerPlanId]);

  const removeCoupon = () => {
    setCoupon(null);
    setCouponInput("");
    setCouponError(null);
    clearCouponCookie(COOKIE_KEYS.offerCoupon);
  };

  const applyCoupon = useCallback(async (code: string, fromLink = false) => {
    setCouponError(null);
    setCouponChecking(true);
    const result = await validateCouponCode(code);
    setCouponChecking(false);
    if (result.coupon) {
      setCoupon(result.coupon);
      setCouponInput(result.coupon.code);
      // The checkout page reads the same cookie a campaign link fills.
      writeCouponCookie(COOKIE_KEYS.offerCoupon, result.coupon.code);
      return;
    }
    setCoupon(null);
    // A dead code that came from a link is not her typo: say which one failed,
    // and stop carrying it.
    if (fromLink) {
      clearCouponCookie(COOKIE_KEYS.offerCoupon);
      setCouponError("link_invalid");
      return;
    }
    setCouponError(result.error ?? "coupon_invalid");
  }, []);

  // Arriving from a campaign link, the code is already in the cookie the
  // middleware stored: confirm it on screen without asking her to type it.
  useEffect(() => {
    const stored = readCouponCookie(COOKIE_KEYS.offerCoupon);
    if (!stored) return;
    setCouponInput(stored);
    setCouponOpen(true);
    void applyCoupon(stored, true);
  }, [applyCoupon]);

  const checkoutHref = (plan: PlanRow) => `/assinatura?plan=${encodeURIComponent(plan.slug)}`;

  /**
   * Switching plans starts a NEW subscription and retires the current one when
   * the new one is paid — no proration at either provider. Whoever is
   * mid-cycle throws away days she already paid for, so she is told first.
   */
  const choose = (plan: PlanRow) => {
    trackOffer("upsell.clicked", "billing", (plan.tier ?? undefined) as OfferKind | undefined);
    if (plan.kind === "recurring" && currentPlan && currentPlan.kind === "recurring" && currentPlan.id !== plan.id) {
      setConfirming(plan);
      return;
    }
    router.push(checkoutHref(plan));
  };

  if (!canManage || shownPlans.length === 0) {
    return canManage && offerMissing ? (
      <Grid size={12}>
        <Alert severity="info">{t("billing-offer-unavailable")}</Alert>
      </Grid>
    ) : null;
  }

  const money = (plan: PlanRow, cents: number) => formatPrice(cents, plan.currency, locale);
  // A fixed discount is an amount in one currency; a percentage applies anywhere.
  const couponFor = (plan: PlanRow) =>
    coupon && (coupon.discountType === "percent" || coupon.currency === plan.currency) ? coupon : undefined;

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-wrap items-start justify-between gap-3">
            <Box>
              <Typography variant="h5" component="h2" className="card-title">
                {offerPlan ? t("billing-offer-title") : t("billing-plans-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {offerPlan ? t("billing-offer-body") : t("billing-plans-body")}
              </Typography>
            </Box>
            <Button variant="text" color="grey" size="small" onClick={() => onCurrencyChange(OTHER_CURRENCY[currency])}>
              {t("billing-currency-switch", {
                currency: t(OTHER_CURRENCY[currency] === "USD" ? "billing-currency-usd" : "billing-currency-brl"),
              })}
            </Button>
          </Box>

          {offerMissing && <Alert severity="info">{t("billing-offer-unavailable")}</Alert>}
          {couponError === "link_invalid" && <Alert severity="info">{t("billing-coupon-link-invalid")}</Alert>}
          {coupon ? (
            <Alert
              severity="success"
              className="neutral"
              action={
                <Button color="grey" size="small" onClick={removeCoupon}>
                  {t("billing-coupon-remove")}
                </Button>
              }
            >
              {coupon.discountType === "percent"
                ? t("billing-coupon-applied-percent", { code: coupon.code, value: coupon.discountValue })
                : t("billing-coupon-applied-fixed", {
                    code: coupon.code,
                    value: formatPrice(coupon.discountValue, coupon.currency ?? currency, locale),
                  })}
            </Alert>
          ) : couponOpen ? (
            <Box className="flex flex-wrap items-start gap-2">
              <TextField
                size="small"
                label={t("billing-coupon-label")}
                value={couponInput}
                onChange={(event) => setCouponInput(event.target.value.toUpperCase())}
                error={couponError === "coupon_invalid" || couponError === "unavailable"}
                helperText={
                  couponError === "coupon_invalid"
                    ? t("billing-coupon-invalid")
                    : couponError === "unavailable"
                      ? t("billing-coupon-unavailable")
                      : undefined
                }
              />
              <Button
                variant="outlined"
                className="mt-1"
                disabled={couponChecking || !normalizeCouponCode(couponInput)}
                onClick={() => void applyCoupon(couponInput)}
              >
                {couponChecking ? t("loading") : t("billing-coupon-apply")}
              </Button>
            </Box>
          ) : (
            <Box>
              {/* Collapsed by default: an empty field on a payment screen reads
                  as a discount she is missing. */}
              <Button variant="text" color="grey" onClick={() => setCouponOpen(true)}>
                {t("billing-coupon-have")}
              </Button>
            </Box>
          )}

          {recurringPlans.length > 0 && (
            <ToggleButtonGroup
              exclusive
              size="small"
              value={period}
              onChange={(_, value: Period | null) => value && setPeriod(value)}
              aria-label={t("billing-period-toggle-label")}
            >
              <ToggleButton value="monthly">{t("billing-period-monthly-option")}</ToggleButton>
              <ToggleButton value="yearly">
                {t("billing-period-yearly-option")}
                {yearlySaving > 0 && (
                  <Chip
                    label={t("billing-yearly-saving", { percent: yearlySaving })}
                    size="small"
                    color="primary"
                    variant="outlined"
                    className="ml-2"
                  />
                )}
              </ToggleButton>
            </ToggleButtonGroup>
          )}

          <Grid container spacing={2.5}>
            {shownPlans.map((plan) => {
              const isKit = plan.kind === "access";
              const current = !isKit && subscription?.planId === plan.id;
              const owned = isKit && entitlements.hasKit;
              const isOffer = plan.id === offerPlan?.id;
              const planCoupon = couponFor(plan);
              const discountedCents = applyDiscount(plan.priceCents, planCoupon);
              const discounted = discountedCents !== plan.priceCents;
              const devices = limitOf(plan.limits, "devices");
              return (
                <Grid key={plan.id} size={{ xs: 12, md: 4 }}>
                  <Card
                    ref={isOffer ? offerRef : undefined}
                    variant="outlined"
                    className={cn("h-full", isOffer && "border-primary")}
                  >
                    <CardContent className="flex h-full flex-col gap-3">
                      <Box className="flex flex-wrap items-center gap-2">
                        <Typography variant="h6" component="h3">
                          {plan.name}
                        </Typography>
                        {current && (
                          <Chip label={t("billing-current-chip")} size="small" color="success" variant="outlined" />
                        )}
                        {owned && (
                          <Chip
                            label={
                              entitlements.accessEndsAt
                                ? t("billing-kit-owned-until", { date: formatDate(entitlements.accessEndsAt) })
                                : t("billing-kit-owned")
                            }
                            size="small"
                            color="success"
                            variant="outlined"
                          />
                        )}
                        {isOffer && !current && <Chip label={t("billing-offer-chip")} size="small" color="primary" />}
                      </Box>
                      <Typography variant="h4" component="p">
                        {money(plan, discountedCents)}
                        <Typography component="span" variant="body2" className="text-text-secondary">
                          {" "}
                          {plan.period
                            ? t(`billing-period-${plan.period}` as never)
                            : plan.accessMonths
                              ? t("billing-access-term", {
                                  term: t(termKey(plan.accessMonths), {
                                    count: accessTermParts(plan.accessMonths).count,
                                  }),
                                })
                              : t("billing-one-time")}
                        </Typography>
                      </Typography>
                      {/* The coupon is named beside the price it gives; the list
                          price is never struck through (docs/PRODUCT.md, "Preço
                          e vagas"). */}
                      {discounted && planCoupon ? (
                        <Typography variant="body2" className="text-text-secondary">
                          {t("billing-price-coupon", { code: planCoupon.code })}
                        </Typography>
                      ) : null}
                      {plan.kind === "access" && currency === "BRL" && maxInstallments > 1 ? (
                        <Typography variant="body2" className="text-text-secondary">
                          {t("billing-installments", {
                            count: maxInstallments,
                            amount: money(plan, splitInstallments(discountedCents, maxInstallments).each),
                          })}
                        </Typography>
                      ) : null}
                      {plan.description && (
                        <Typography variant="body2" className="text-text-secondary">
                          {plan.description}
                        </Typography>
                      )}
                      <Box component="ul" className="m-0 flex flex-1 list-none flex-col gap-1 p-0">
                        {enabledFeatures(plan.limits).map((key) => (
                          <Typography
                            key={key}
                            component="li"
                            variant="body2"
                            className="text-text-secondary flex items-start gap-1.5"
                          >
                            <NiCheck size="small" className="text-primary mt-0.5 flex-none" />
                            {t(FEATURE_LABEL[key as FeatureKey])}
                          </Typography>
                        ))}
                        {devices > 0 && (
                          <Typography
                            component="li"
                            variant="body2"
                            className="text-text-secondary flex items-start gap-1.5"
                          >
                            <NiCheck size="small" className="text-primary mt-0.5 flex-none" />
                            {t("billing-feature-devices", { count: devices })}
                          </Typography>
                        )}
                      </Box>
                      {current ? (
                        <Button variant="outlined" disabled>
                          {t("billing-current-chip")}
                        </Button>
                      ) : owned && !checkoutAvailable ? (
                        <Button variant="outlined" disabled>
                          {t("billing-kit-owned")}
                        </Button>
                      ) : owned ? (
                        // Buying the access again renews it: the new term starts when the current one ends.
                        <Button variant="outlined" onClick={() => choose(plan)}>
                          {t("billing-renew-kit")}
                        </Button>
                      ) : checkoutAvailable ? (
                        <Button variant={isOffer || isKit ? "contained" : "outlined"} onClick={() => choose(plan)}>
                          {isKit
                            ? t("billing-buy-kit")
                            : currentPlan && currentPlan.kind === "recurring"
                              ? t("billing-switch-plan")
                              : t("billing-subscribe")}
                        </Button>
                      ) : (
                        <Button
                          variant="outlined"
                          href="/contato?assunto=planos"
                          LinkComponent={Link}
                          onClick={() => trackOffer("upsell.clicked", "billing")}
                        >
                          {t("billing-contact-plan")}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </CardContent>
      </Card>

      {/* Switching is not an edit to the current subscription: it opens a new
          one and retires the old one when the new one is paid. Neither provider
          credits the days already paid, so she has to be told before she pays. */}
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>{t("billing-switch-title", { plan: confirming?.name ?? "" })}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t("billing-switch-warning", { current: currentPlan?.name ?? "", next: confirming?.name ?? "" })}
          </DialogContentText>
          {subscription?.currentPeriodEnd && (
            <DialogContentText className="mt-3">
              {t("billing-switch-period-note", {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(
                  new Date(subscription.currentPeriodEnd),
                ),
              })}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setConfirming(null)}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => confirming && router.push(checkoutHref(confirming))}>
            {t("billing-switch-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
