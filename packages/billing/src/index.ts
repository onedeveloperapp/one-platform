import { providerNameForCurrency } from "./currency";
import { AsaasProvider, asaasPixAvailable } from "./providers/asaas";
import { StripeProvider } from "./providers/stripe";
import type { BillingProviderName, PaymentProvider } from "./types";

export * from "./currency";
export * from "./entitlements";
export * from "./types";

export const isStripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
export const isAsaasConfigured = Boolean(process.env.ASAAS_API_KEY);

/** Providers available in this deployment, in display order. */
export function configuredProviders(): BillingProviderName[] {
  const providers: BillingProviderName[] = [];
  if (isStripeConfigured) providers.push("stripe");
  if (isAsaasConfigured) providers.push("asaas");
  return providers;
}

/**
 * The provider that charges a currency in THIS deployment: BRL through Asaas,
 * USD through Stripe (`./currency`). Null when that provider is not
 * configured, and then the plans in that currency are not on sale here. The
 * money is never rerouted to the other provider: a BRL price charged by
 * Stripe would skip the PIX, the installments and the NFS-e the buyer was
 * promised.
 */
export function providerForCurrency(currency: string | null | undefined): BillingProviderName | null {
  const name = providerNameForCurrency(currency);
  if (name === "asaas") return isAsaasConfigured ? "asaas" : null;
  if (name === "stripe") return isStripeConfigured ? "stripe" : null;
  return null;
}

/**
 * Whether the checkout should offer Pix.
 *
 * Decided by what the ACCOUNT can do, not by a switch someone has to remember
 * to flip. The first version of this was an env var defaulting to off, which
 * meant a production account with an active Pix key — verified — still only
 * offered card, and nobody could tell why from the screen.
 *
 * Offering a method the account cannot charge fails at the last step of the
 * funnel, so the account is asked. `BILLING_PIX_ENABLED=false` remains as a
 * kill switch for the day Pix has to come off in a hurry. Pix only exists for
 * BRL, so it is an Asaas question.
 */
export async function isPixAvailable(): Promise<boolean> {
  if ((process.env.BILLING_PIX_ENABLED ?? "").trim().toLowerCase() === "false") return false;
  if (!isAsaasConfigured) return false;
  return asaasPixAvailable();
}

export function getProvider(name: BillingProviderName): PaymentProvider {
  switch (name) {
    case "stripe":
      return new StripeProvider();
    case "asaas":
      return new AsaasProvider();
  }
}
