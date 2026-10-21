"use client";

import { startCheckout } from "../(dashboard)/settings/billing/actions";
import PaymentChoice, { type PaymentChoiceValue } from "./payment-choice";
import PixPaymentPanel from "./pix-payment-panel";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Divider, Grid, TextField, Typography } from "@mui/material";

import { CepField, CpfCnpjField, PhoneField } from "@/components/product/fields";
import { COOKIE_KEYS } from "@/constants";
import { localizeHref } from "@/i18n/routing";
import NiCheck from "@/icons/nexture/ni-check";
import { accessTermParts } from "@/lib/access-term";
import type { CampaignParams } from "@/lib/campaign-params";
import { readCouponCookie } from "@/lib/offer-link";
import { createClient } from "@flyee/auth/client";
import type { PixCharge } from "@flyee/billing/types";
import { formatCep, formatCpfCnpj, formatPhoneBr, isValidCpfCnpj, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/** The plural-aware key of a term ("1 ano", "18 meses"); both literals, so the message pruner sees them. */
const termKey = (months: number) =>
  accessTermParts(months).unit === "years" ? "access-term-years" : "access-term-months";

type Profile = {
  document: string | null;
  postalCode: string | null;
  addressNumber: string | null;
  phone: string | null;
};

/** Errors with a sentence of their own; anything else reads as the generic failure. */
const ERROR_KEY: Record<string, string> = {
  document_invalid: "checkout-error-document",
  phone_invalid: "checkout-error-phone",
  profile_save_failed: "checkout-error-profile",
  billing_profile_required: "checkout-error-profile-required",
  coupon_invalid: "checkout-error-coupon",
  suspended: "checkout-error-suspended",
  pix_unavailable: "checkout-error-pix",
  currency_unavailable: "checkout-error-currency",
};

/**
 * The whole purchase, in one submit (docs/BILLING.md).
 *
 * BRL goes through Asaas, which needs the payer's CPF or CNPJ and lets her
 * choose PIX or card (installments on a yearly plan): the document and the
 * payment are one gesture, and the button says where it goes. USD goes
 * through Stripe's own secure page, which collects the card itself, so the
 * only step here is the summary and one button.
 */
export default function CheckoutForm({
  orgId,
  planId,
  planName,
  priceLabel,
  currency,
  oneTime,
  accessMonths,
  renewalFrom,
  guaranteeDays,
  canManage,
  switchingFrom,
  profile,
  priceCents,
  maxInstallments,
  pixAvailable,
  campaign,
}: {
  orgId: string;
  planId: string;
  planName: string;
  priceLabel: string;
  currency: "BRL" | "USD";
  /** The kit: a one-time access purchase. */
  oneTime: boolean;
  /** How long the access lasts, in months; null when it has no end. */
  accessMonths: number | null;
  /** The end of the access the workspace already holds: this purchase renews it from that day. */
  renewalFrom: string | null;
  guaranteeDays: number;
  canManage: boolean;
  switchingFrom: string | null;
  profile: Profile;
  /** Drives the instalment labels; the server re-derives the real amount. */
  priceCents: number;
  /** The instalments this purchase may be split into (1 = none). */
  maxInstallments: number;
  /** False while the account cannot charge Pix, so it is never offered. */
  pixAvailable: boolean;
  /** The campaign of this purchase (last touch), forwarded from the landing link. */
  campaign?: CampaignParams;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const brl = currency === "BRL";
  const [document, setDocument] = useState(() => (profile.document ? formatCpfCnpj(profile.document) : ""));
  const [postalCode, setPostalCode] = useState(() => (profile.postalCode ? formatCep(profile.postalCode) : ""));
  const [addressNumber, setAddressNumber] = useState(profile.addressNumber ?? "");
  const [phone, setPhone] = useState(() => (profile.phone ? formatPhoneBr(profile.phone) : ""));
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // Pre-selected: an unselected choice is one more decision between her and
  // the purchase, and the card is the method that renews by itself.
  const [payment, setPayment] = useState<PaymentChoiceValue>({ method: "credit_card", installments: 1 });
  // Stable across retries so a second click cannot open a second invoice for
  // the same intent; regenerated only when the attempt is abandoned.
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  // The PIX charge, once the server returns one. From then on the form is
  // gone: the purchase exists, and what is left is paying it.
  const [pix, setPix] = useState<PixCharge | null>(null);

  const submit = async () => {
    setError(null);
    if (brl) {
      if (!isValidCpfCnpj(document)) {
        setError("document_invalid");
        return;
      }
      if (phone && !isValidPhoneBr(phone)) {
        setError("phone_invalid");
        return;
      }
    }
    setWorking(true);

    if (brl) {
      // Persist the fiscal data first: the provider refuses to create a
      // customer without it, and Asaas issues the NFS-e from it.
      const supabase = createClient();
      const { data, error: saveError } = await supabase.rpc("update_billing_profile", {
        target_org: orgId,
        // Digits, never the mask — the repo-wide rule for semantic fields.
        target_cpf_cnpj: onlyDigits(document),
        target_postal_code: postalCode ? onlyDigits(postalCode) : null,
        target_address_number: addressNumber.trim() || null,
        target_phone: phone ? onlyDigits(phone) : null,
      });
      if (saveError || (data as { ok?: boolean } | null)?.ok !== true) {
        setWorking(false);
        setError("profile_save_failed");
        return;
      }
    }

    // The campaign code the middleware captured on the click, before sign-up
    // and e-mail confirmation stripped the query string.
    const coupon = readCouponCookie(COOKIE_KEYS.offerCoupon);
    const result = await startCheckout({
      orgId,
      planId,
      idempotencyKey: operationKey,
      couponCode: coupon || null,
      paymentMethod: brl ? payment.method : null,
      installments: brl ? payment.installments : 1,
      campaign: campaign ?? null,
      // Back to the home of the member area, whichever way she paid.
      returnTo: "home",
    });
    if (!result.url) {
      setWorking(false);
      // A fresh key for the next attempt: the failed one may have a provider
      // session attached to a state she has just changed.
      setOperationKey(crypto.randomUUID());
      // Pix refused: put her on the card, already selected.
      if (result.error === "pix_unavailable") setPayment({ method: "credit_card", installments: 1 });
      setError(result.error ?? "unavailable");
      return;
    }
    // PIX with a readable QR stays HERE. Everything else — card, Stripe, or a
    // QR the provider did not return in time — goes to the hosted page.
    if (result.pix) {
      setWorking(false);
      setPix(result.pix);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.location.assign(result.url);
  };

  if (pix) {
    return (
      <PixPaymentPanel
        pix={pix}
        orgId={orgId}
        planId={planId}
        planName={planName}
        priceLabel={priceLabel}
        oneTime={oneTime}
      />
    );
  }

  if (!canManage) {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("checkout-manager-only")}
      </Alert>
    );
  }

  const errorKey = error ? (ERROR_KEY[error] ?? "checkout-error-generic") : null;

  return (
    <Box className="flex flex-col gap-6">
      <Box className="flex flex-col gap-1">
        <Typography variant="h1" component="h1" className="mb-0">
          {oneTime ? t("checkout-title-kit") : t("checkout-title-subscription")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {brl ? t("checkout-subtitle-brl") : t("checkout-subtitle-usd")}
        </Typography>
      </Box>

      {switchingFrom && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("checkout-switch-warning", { plan: switchingFrom })}
        </Alert>
      )}

      {brl && (
        <>
          <Box className="flex flex-col gap-3">
            <Typography variant="subtitle2" className="text-text-secondary">
              {t("checkout-step-details")}
            </Typography>
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <CpfCnpjField
                  label={t("checkout-document")}
                  value={document}
                  onChange={(event) => setDocument(event.target.value)}
                  invalidMessage={t("checkout-document-invalid")}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <PhoneField
                  label={t("checkout-phone")}
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  invalidMessage={t("checkout-phone-invalid")}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <CepField
                  label={t("checkout-postal-code")}
                  value={postalCode}
                  onChange={(event) => setPostalCode(event.target.value)}
                  invalidMessage={t("checkout-postal-code-invalid")}
                  fullWidth
                  size="small"
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t("checkout-address-number")}
                  value={addressNumber}
                  onChange={(event) => setAddressNumber(event.target.value)}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          </Box>
          <Divider />
        </>
      )}

      <Box className="flex flex-col gap-3">
        {brl && (
          <>
            <Typography variant="subtitle2" className="text-text-secondary">
              {t("checkout-step-payment")}
            </Typography>
            <PaymentChoice
              value={payment}
              onChange={setPayment}
              pixAvailable={pixAvailable}
              maxInstallments={maxInstallments}
              oneTime={oneTime}
              priceCents={priceCents}
              disabled={working}
            />
          </>
        )}

        <Box className="border-grey-200 flex flex-col gap-2 rounded-2xl border p-5">
          <Typography variant="h6" component="p" className="mb-0">
            {planName}
          </Typography>
          <Typography variant="h4" component="p" className="mb-0">
            {priceLabel}
          </Typography>
          <Box component="ul" className="text-text-secondary m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {oneTime && (
              <li className="flex items-center gap-1">
                <NiCheck size="small" className="text-primary" />{" "}
                {accessMonths
                  ? t("checkout-kit-term", {
                      term: t(termKey(accessMonths), { count: accessTermParts(accessMonths).count }),
                    })
                  : t("checkout-kit-forever")}
              </li>
            )}
            {renewalFrom && (
              <li className="flex items-center gap-1">
                <NiCheck size="small" className="text-primary" />{" "}
                {t("checkout-renewal-note", { date: new Intl.DateTimeFormat(locale).format(new Date(renewalFrom)) })}
              </li>
            )}
            <li className="flex items-center gap-1">
              <NiCheck size="small" className="text-primary" /> {t("checkout-guarantee", { days: guaranteeDays })}
            </li>
            {!oneTime && (
              <li className="flex items-center gap-1">
                <NiCheck size="small" className="text-primary" /> {t("checkout-cancel-anytime")}
              </li>
            )}
          </Box>
        </Box>
      </Box>

      {errorKey && (
        <Alert severity={error === "pix_unavailable" ? "info" : "error"} className="bg-background-paper/60!">
          {t(errorKey)}
        </Alert>
      )}

      <Button variant="contained" size="large" onClick={() => void submit()} disabled={working}>
        {working
          ? t("checkout-submitting")
          : !brl
            ? t("checkout-pay-stripe")
            : payment.method === "pix"
              ? t("checkout-pay-pix")
              : t("checkout-pay-card")}
      </Button>

      <Typography variant="body2" className="text-text-secondary text-center">
        {t("checkout-footer", { days: guaranteeDays })}{" "}
        <Link
          href={localizeHref("/legal/termos", locale)}
          target="_blank"
          rel="noopener noreferrer"
          className="link-primary"
        >
          {t("checkout-terms")}
        </Link>
        .
      </Typography>
    </Box>
  );
}
