"use client";

import SettingsMenu from "../components/settings-menu";
import { checkoutAvailability } from "./actions";
import BillingProfileCard from "./components/billing-profile-card";
import CurrentSubscription from "./components/current-subscription";
import InvoicesCard from "./components/invoices-card";
import PaymentRecoveryCard from "./components/payment-recovery-card";
import PendingCheckoutCard from "./components/pending-checkout-card";
import PlansGrid from "./components/plans-grid";
import { useBilling } from "./components/use-billing";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Breadcrumbs, Button, CircularProgress, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import NiListCircle from "@/icons/nexture/ni-list-circle";
import { resolveCurrency } from "@/lib/billing-currency";
import { readCurrencyCookie, writeCurrencyCookie } from "@/lib/currency-cookie";
import { remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@/lib/remote-state";
import type { BillingCurrency } from "@flyee/billing/currency";

export default function BillingSettings() {
  const t = useTranslations("product");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const checkout = searchParams.get("checkout");
  const feature = searchParams.get("feature");
  // The offer she was sent by link (`?plan=club-fundador-anual`): the grid
  // surfaces it even when it is unlisted, and says so when the offer ended.
  const offerSlug = searchParams.get("plan");
  const [openDrawer, setOpenDrawer] = useState(false);
  // Her own pick (the cookie) wins; otherwise the language decides. Resolved
  // after mount, where the cookie is readable, so server and client agree.
  const [currency, setCurrency] = useState<BillingCurrency>(() => resolveCurrency({ locale }));
  useEffect(() => {
    setCurrency(resolveCurrency({ cookie: readCurrencyCookie(), locale }));
  }, [locale]);
  const [checkoutState, setCheckoutState] = useState<
    RemoteState<{ available: boolean; maxInstallments: number }, "check_failed">
  >(() => remoteLoading());
  const {
    configured,
    loading,
    orgsState,
    detailsState,
    loadFailed,
    refreshing,
    currentOrg,
    canManage,
    subscription,
    pendingCheckout,
    billingProfile,
    plans,
    entitlements,
    invoices,
    retry,
    refreshDetails,
  } = useBilling();
  // A failed renewal keeps the plan usable for a grace window; this screen's
  // first job in that state is getting the charge paid.
  const pastDue = subscription?.status === "past_due";

  const loadCheckoutAvailability = useCallback(async (target: BillingCurrency) => {
    setCheckoutState(remoteLoading());
    try {
      setCheckoutState(remoteSuccess(await checkoutAvailability(target)));
    } catch {
      setCheckoutState(remoteError("check_failed"));
    }
  }, []);

  useEffect(() => {
    void loadCheckoutAvailability(currency);
  }, [currency, loadCheckoutAvailability]);

  const changeCurrency = (next: BillingCurrency) => {
    writeCurrencyCookie(next);
    setCurrency(next);
  };

  const checkoutAvailable = checkoutState.status === "success" ? checkoutState.data.available : undefined;
  const maxInstallments = checkoutState.status === "success" ? checkoutState.data.maxInstallments : 1;
  const detailsAvailable =
    detailsState.status === "success" ||
    ((detailsState.status === "loading" || detailsState.status === "error") && Boolean(detailsState.previous));

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size="auto" className="hidden pr-8 lg:flex">
        <SettingsMenu active="billing" />
      </Grid>
      <Grid size="grow" spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("billing-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-billing")}</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                aria-label={t("settings-open-menu")}
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
              >
                <NiListCircle size="medium" />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!configured && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-unavailable")}</Alert>
          </Grid>
        )}
        {checkout === "success" && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-checkout-processing")}</Alert>
          </Grid>
        )}
        {checkout === "canceled" && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-checkout-canceled")}</Alert>
          </Grid>
        )}
        {/* She arrived here from a payment problem, not from shopping. Say so,
            so the plan grid below does not read as the answer to her question. */}
        {feature === "payment" && (
          <Grid size={12}>
            <Alert severity="warning" className="neutral">
              {t("billing-past-due-context")}
            </Alert>
          </Grid>
        )}
        {checkoutState.status === "error" && (
          <Grid size={12}>
            <Alert
              severity="error"
              action={<Button onClick={() => void loadCheckoutAvailability(currency)}>{t("retry")}</Button>}
            >
              {t("billing-provider-check-error")}
            </Alert>
          </Grid>
        )}
        {checkoutState.status === "success" && checkoutAvailable === false && (
          <Grid size={12}>
            <Alert severity="info">{t("billing-provider-unavailable")}</Alert>
          </Grid>
        )}
        {loadFailed && (
          <Grid size={12}>
            <Alert severity="error" action={<Button onClick={() => void retry()}>{t("retry")}</Button>}>
              {t("billing-load-error")}
            </Alert>
          </Grid>
        )}
        {configured && loading && (
          <Grid size={12} aria-live="polite">
            <CircularProgress size={24} aria-label={t("loading")} />
          </Grid>
        )}
        {refreshing && (
          <Grid size={12} aria-live="polite">
            <CircularProgress size={18} aria-label={t("loading")} />
          </Grid>
        )}
        {configured && orgsState.status === "empty" && (
          <Grid size={12}>
            <Alert severity="info">{t("settings-practice-missing")}</Alert>
          </Grid>
        )}

        {currentOrg && detailsAvailable && (
          <>
            {/* First, because she is here to FIX a charge, not to shop. */}
            {canManage && pastDue && (
              <Grid size={12}>
                <PaymentRecoveryCard orgId={currentOrg.id} />
              </Grid>
            )}
            {/* Before the plan grid: she is waiting on a payment she already
                made, and a row of "choose a plan" buttons reads as proof it
                failed — which is what produced duplicate checkouts. */}
            {canManage && pendingCheckout && (
              <PendingCheckoutCard orgId={currentOrg.id} pending={pendingCheckout} onChanged={refreshDetails} />
            )}
            <CurrentSubscription
              orgId={currentOrg.id}
              subscription={subscription}
              entitlements={entitlements}
              canManage={canManage}
              onChanged={refreshDetails}
            />
            <PlansGrid
              subscription={subscription}
              plans={plans}
              currency={currency}
              onCurrencyChange={changeCurrency}
              entitlements={entitlements}
              canManage={canManage}
              checkoutAvailable={checkoutState.status === "success" && checkoutAvailable === true}
              maxInstallments={maxInstallments}
              offerSlug={offerSlug}
            />
            {/* The fiscal data only exists for BRL (Asaas issues the NFS-e
                from it); the checkout asks for it too, this is where it is
                kept up to date. */}
            {canManage && currency === "BRL" && (
              <BillingProfileCard
                orgId={currentOrg.id}
                profile={billingProfile}
                required={false}
                continuesToCheckout={false}
                onSaved={() => void refreshDetails()}
              />
            )}
            <InvoicesCard invoices={invoices} />
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="billing" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
