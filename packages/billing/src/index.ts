import { providerNameForCurrency } from "./currency";
import { AsaasProvider, asaasPixAvailable } from "./providers/asaas";
import type { BillingProviderName, PaymentProvider } from "./types";

export * from "./currency";
export * from "./entitlements";
export * from "./types";

export const isAsaasConfigured = Boolean(process.env.ASAAS_API_KEY);

/** Providers available in this deployment, in display order. */
export function configuredProviders(): BillingProviderName[] {
  return isAsaasConfigured ? ["asaas"] : [];
}

/**
 * The provider that charges a currency in THIS deployment: BRL through Asaas. Null when Asaas is not configured, or
 * for a currency ONE does not sell in.
 */
export function providerForCurrency(currency: string | null | undefined): BillingProviderName | null {
  return providerNameForCurrency(currency) === "asaas" && isAsaasConfigured ? "asaas" : null;
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

export function getProvider(_name: BillingProviderName = "asaas"): PaymentProvider {
  return new AsaasProvider();
}
