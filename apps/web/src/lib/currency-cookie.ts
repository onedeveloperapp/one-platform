import { COOKIE_KEYS } from "@/constants";
import { CURRENCY_COOKIE_MAX_AGE, normalizeCurrency } from "@/lib/billing-currency";
import type { BillingCurrency } from "@flyee/billing/currency";

/** The currency the visitor picked, from the browser (null when none). */
export function readCurrencyCookie(): BillingCurrency | null {
  if (typeof document === "undefined") return null;
  const name = COOKIE_KEYS.currency;
  const match = document.cookie.split("; ").find((entry) => entry.startsWith(`${name}=`));
  return normalizeCurrency(match ? decodeURIComponent(match.slice(name.length + 1)) : null);
}

/** Remembers a currency picked in the app (the same cookie a `?moeda=` link sets). */
export function writeCurrencyCookie(currency: BillingCurrency): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_KEYS.currency}=${currency}; path=/; max-age=${CURRENCY_COOKIE_MAX_AGE}; SameSite=Lax`;
}
