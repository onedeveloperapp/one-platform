import { type BillingCurrency, currencyForLocale, isBillingCurrency } from "@flyee/billing/currency";

/**
 * Which currency a visitor sees and buys in (docs/BILLING.md). Pure, so the
 * middleware, the pages and the server actions share one answer.
 *
 * The visitor's own choice wins (the `moeda` cookie, set from a `?moeda=`
 * link or the currency switch); without one, the language decides:
 * Portuguese reads BRL, English reads USD. The currency then decides the
 * provider (BRL Asaas, USD Stripe), never the other way round.
 */

/** The link parameter that picks the currency (`/planos?moeda=USD`), captured by the middleware. */
export const CURRENCY_PARAM = "moeda";

/** A deliberate choice outlives the session, like the language. One year. */
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeCurrency(value: string | null | undefined): BillingCurrency | null {
  const code = (value ?? "").trim().toUpperCase();
  return isBillingCurrency(code) ? code : null;
}

export function resolveCurrency({
  cookie,
  locale,
}: {
  cookie?: string | null;
  locale?: string | null;
}): BillingCurrency {
  return normalizeCurrency(cookie) ?? currencyForLocale(locale);
}
