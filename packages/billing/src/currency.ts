/**
 * Money routing. Pure and import-free, so client components can read it through `@flyee/billing/currency` without
 * pulling a provider into the browser bundle.
 *
 * ONE bills its subscription in reais through Asaas (PIX, card, the NFS-e Asaas issues): one currency, one provider.
 * A currency ONE does not sell in has no provider.
 */
import type { BillingProviderName } from "./types";

export type BillingCurrency = "BRL";

export const BILLING_CURRENCIES: readonly BillingCurrency[] = ["BRL"];

export const isBillingCurrency = (value: unknown): value is BillingCurrency =>
  typeof value === "string" && (BILLING_CURRENCIES as readonly string[]).includes(value);

/** The single routing table. */
export const CURRENCY_PROVIDER: Record<BillingCurrency, BillingProviderName> = {
  BRL: "asaas",
};

/** The provider a currency routes to, configured or not; null for a currency ONE does not sell in. */
export function providerNameForCurrency(currency: string | null | undefined): BillingProviderName | null {
  const code = (currency ?? "").trim().toUpperCase();
  return isBillingCurrency(code) ? CURRENCY_PROVIDER[code] : null;
}

/** The currency a visitor sees prices in: ONE sells in reais only, whatever the page. */
export function currencyForLocale(_locale?: string | null): BillingCurrency {
  return "BRL";
}

/**
 * The most installments a card purchase may ever be split into. The offer
 * itself is configuration (`platform_settings.billing.max_installments`) and
 * is clamped to this ceiling, which is the providers' own limit.
 */
export const PROVIDER_MAX_INSTALLMENTS = 12;

/**
 * A price as people write it: "R$ 97" when the amount is whole, "R$ 77,60"
 * when it has cents, never "R$ 77,6" (what Intl prints with 0 to 2 fraction
 * digits) and never a rounded figure that differs from what is charged. Every
 * price a visitor or a member reads goes through here.
 */
export function formatPrice(amountCents: number, currency: string, locale: string): string {
  const digits = Math.round(amountCents) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountCents / 100);
}
