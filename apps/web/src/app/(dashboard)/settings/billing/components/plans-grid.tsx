"use client";

import { type AppliedCoupon, validateCouponCode } from "../actions";
import { changeTier } from "../actions-plan";
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

import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import { COOKIE_KEYS } from "@/constants";
import NiCheck from "@/icons/nexture/ni-check";
import { clearCouponCookie, normalizeCouponCode, readCouponCookie, writeCouponCookie } from "@/lib/offer-link";
import { type OfferKind, trackOffer } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { type BillingCurrency, formatPrice } from "@flyee/billing/currency";
import { type CeilingKey, ceilingsOf, enabledFeatures, type FeatureKey } from "@flyee/billing/entitlements";
import { applyDiscount } from "@flyee/billing/types";

type Period = "monthly" | "yearly";

/** Each ceiling a tier sets, in the words of the grid. */
const CEILING_LABEL: Record<CeilingKey, string> = {
  processos_ativos_max: "billing-ceiling-processos_ativos_max",
  assentos_max: "billing-ceiling-assentos_max",
  whatsapp_numeros_max: "billing-ceiling-whatsapp_numeros_max",
};

/** Each right a tier or an add-on turns on. */
const FEATURE_LABEL: Record<FeatureKey, string> = {
  monitor_voo: "billing-feature-monitor_voo",
};

/** Why a change of tier did not go, in the screen's words. */
const CHANGE_ERROR: Record<string, string> = {
  not_allowed: "billing-change-tier-not-allowed",
  support_visit: "billing-change-tier-support",
  canceling: "billing-change-tier-canceling",
  provider_unavailable: "billing-change-tier-provider",
  unrecorded: "billing-change-tier-unrecorded",
};

/**
 * ONE's tiers on the billing screen (migration 0202): the public plans of the
 * chosen period, in the order of their tier's rank, each with the ceilings it
 * sets and the rights it turns on, in reais. A firm with no subscription goes
 * on to the focused checkout (`/assinatura?plan=`), the one place that asks for
 * the fiscal data and the payment method; a firm subscribed changes its tier
 * on the subscription in force (`changeTier`), with the second factor, and a
 * plan of the other period starts a new subscription, as before.
 */
export default function PlansGrid({
  subscription,
  plans,
  currency,
  canManage,
  checkoutAvailable,
  offerSlug,
}: {
  subscription: SubscriptionInfo | null;
  plans: PlanRow[];
  currency: BillingCurrency;
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
  const router = useRouter();
  const [confirming, setConfirming] = useState<PlanRow | null>(null);
  // A change of tier on the subscription in force, and what came of it.
  const [changing, setChanging] = useState<PlanRow | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [factor, setFactor] = useState<"missing" | "challenge" | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
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

  const inCurrency = paidPlans.filter(
    (plan) => plan.currency === currency && plan.isPublic && plan.kind === "recurring" && !plan.isAddon,
  );
  const periodPlans = (wanted: Period) =>
    inCurrency.filter((plan) => plan.period === wanted).sort((a, b) => a.rank - b.rank || a.priceCents - b.priceCents);
  const recurringPlans = periodPlans(period);
  // The yearly saving, from real prices, for the toggle label: each tier's yearly plan against twelve of its monthly.
  const savings = periodPlans("yearly")
    .map((yearly) => {
      const monthly = periodPlans("monthly").find((plan) => plan.family === yearly.family);
      if (!monthly || monthly.priceCents <= 0) return 0;
      return Math.round((1 - yearly.priceCents / (monthly.priceCents * 12)) * 100);
    })
    .filter((value) => value > 0);
  const yearlySaving = savings.length > 0 ? Math.min(...savings) : 0;

  const shownPlans = [
    ...(offerPlan && !recurringPlans.some((plan) => plan.id === offerPlan.id) ? [offerPlan] : []),
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
   * A firm subscribed changes its tier on the subscription in force (same period): Asaas takes the new value from the
   * next charge on. A plan of the other period starts a new subscription and retires the current one when it is paid,
   * with no proration, so she is told first. A firm with none goes to the checkout.
   */
  const choose = (plan: PlanRow) => {
    trackOffer("upsell.clicked", "billing", (plan.tier ?? undefined) as OfferKind | undefined);
    if (currentPlan && currentPlan.kind === "recurring" && currentPlan.id !== plan.id) {
      if (plan.period === currentPlan.period && subscription?.changeable) {
        setChanging(plan);
        setChangeError(null);
        return;
      }
      setConfirming(plan);
      return;
    }
    router.push(checkoutHref(plan));
  };

  const confirmChange = async () => {
    if (!changing || !subscription) return;
    setChangeBusy(true);
    setChangeError(null);
    const result = await changeTier(subscription.orgId, changing.id);
    setChangeBusy(false);
    if (result.ok) {
      setChanging(null);
      setChanged(result.planName || changing.name);
      router.refresh();
      return;
    }
    if (result.code === "second_factor") setFactor(result.factor ?? "challenge");
    setChangeError(result.code);
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
          </Box>

          {changed ? (
            <Alert severity="success" className="neutral" onClose={() => setChanged(null)}>
              {t("billing-tier-changed", { plan: changed })}
            </Alert>
          ) : null}
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
              const current = subscription?.planId === plan.id;
              const isOffer = plan.id === offerPlan?.id;
              const planCoupon = couponFor(plan);
              const discountedCents = applyDiscount(plan.priceCents, planCoupon);
              const discounted = discountedCents !== plan.priceCents;
              const sameTierPeriod = Boolean(currentPlan && plan.period === currentPlan.period);
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
                        {isOffer && !current && <Chip label={t("billing-offer-chip")} size="small" color="primary" />}
                      </Box>
                      <Typography variant="h4" component="p">
                        {money(plan, discountedCents)}
                        <Typography component="span" variant="body2" className="text-text-secondary">
                          {" "}
                          {plan.period ? t(`billing-period-${plan.period}` as never) : t("billing-one-time")}
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
                      {plan.description && (
                        <Typography variant="body2" className="text-text-secondary">
                          {plan.description}
                        </Typography>
                      )}
                      <Box component="ul" className="m-0 flex flex-1 list-none flex-col gap-1 p-0">
                        {ceilingsOf(plan.limits).map(({ key, value }) => (
                          <Typography
                            key={key}
                            component="li"
                            variant="body2"
                            className="text-text-secondary flex items-start gap-1.5"
                          >
                            <NiCheck size="small" className="text-primary mt-0.5 flex-none" />
                            {t(CEILING_LABEL[key], { count: value })}
                          </Typography>
                        ))}
                        {enabledFeatures(plan.limits).map((key) => (
                          <Typography
                            key={key}
                            component="li"
                            variant="body2"
                            className="text-text-secondary flex items-start gap-1.5"
                          >
                            <NiCheck size="small" className="text-primary mt-0.5 flex-none" />
                            {t(FEATURE_LABEL[key])}
                          </Typography>
                        ))}
                      </Box>
                      {current ? (
                        <Button variant="outlined" disabled>
                          {t("billing-current-chip")}
                        </Button>
                      ) : checkoutAvailable ? (
                        <Button variant={isOffer ? "contained" : "outlined"} onClick={() => choose(plan)}>
                          {currentPlan && currentPlan.kind === "recurring"
                            ? sameTierPeriod
                              ? t("billing-change-tier")
                              : t("billing-switch-plan")
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

      {/* A change of tier on the subscription in force: the new value from the next charge on, the day of charge
          kept. The second factor is asked here, in place. */}
      <Dialog
        open={Boolean(changing)}
        onClose={changeBusy ? undefined : () => setChanging(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("billing-change-tier-title", { plan: changing?.name ?? "" })}</DialogTitle>
        <DialogContent className="flex flex-col gap-3">
          <DialogContentText>
            {t("billing-change-tier-body", {
              current: currentPlan?.name ?? "",
              next: changing?.name ?? "",
              price: changing ? money(changing, changing.priceCents) : "",
            })}
          </DialogContentText>
          {factor ? (
            <SecondFactorPrompt
              state={factor}
              onConfirmed={() => {
                setFactor(null);
                setChangeError(null);
              }}
            />
          ) : null}
          {changeError && changeError !== "second_factor" ? (
            <Alert severity="error" className="neutral">
              {t(CHANGE_ERROR[changeError] ?? "billing-change-tier-error")}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setChanging(null)} disabled={changeBusy}>
            {t("cancel")}
          </Button>
          <Button variant="contained" onClick={() => void confirmChange()} disabled={changeBusy || factor !== null}>
            {changeBusy ? t("loading") : t("billing-change-tier-confirm")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
