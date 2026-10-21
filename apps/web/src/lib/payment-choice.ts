import { PROVIDER_MAX_INSTALLMENTS } from "@flyee/billing/currency";
import type { PaymentMethod } from "@flyee/billing/types";

/**
 * What the customer may actually be charged, decided on the server.
 *
 * The form offers what it offers, but a form is a suggestion: a server action
 * is a public endpoint, and the values that reach the provider are settled
 * here. The rules, all of them money:
 *
 *  - **Methods belong to a currency.** PIX and a chosen card exist only in BRL
 *    (Asaas); a USD purchase goes to Stripe's own checkout, which picks the
 *    method itself.
 *  - **Installments only on a card.** Pix has no instalment concept at Asaas;
 *    asking for 5x on Pix would silently produce five separate charges the
 *    customer has to pay by hand, which is not what either side agreed to.
 *  - **Installments on a yearly plan or on the one-time access, never on a
 *    monthly plan.** Splitting a monthly price would sell a year of billing
 *    cycles for one month's money. The access is one purchase valid for a
 *    term, so splitting it changes nothing about what was bought.
 *  - **Clamped to the offer** (`platform_settings.billing.max_installments`).
 *    A crafted request asking for 12x must not open a 12x checkout just
 *    because nothing in the browser stopped it.
 *
 * Pure, so the rule can be tested without a provider or a network.
 */
export type ResolvedPaymentChoice = { method: PaymentMethod | undefined; installments: number };

export function resolvePaymentChoice(input: {
  method?: string | null;
  installments?: number | null;
  planPeriod: string | null;
  /** A one-time access ("access") may be split; a recurring plan only when yearly. */
  planKind: "recurring" | "access";
  currency: string;
  /** The configured ceiling; 1 turns installments off. */
  maxInstallments: number;
}): ResolvedPaymentChoice {
  const brl = input.currency.trim().toUpperCase() === "BRL";
  const method: PaymentMethod | undefined =
    brl && (input.method === "credit_card" || input.method === "pix") ? input.method : undefined;

  const asked = Number(input.installments);
  const wanted = Number.isFinite(asked) ? Math.floor(asked) : 1;
  const ceiling = Math.max(1, Math.min(Math.floor(input.maxInstallments) || 1, PROVIDER_MAX_INSTALLMENTS));
  const splittable =
    method === "credit_card" &&
    ceiling > 1 &&
    (input.planKind === "access" || (input.planPeriod !== null && input.planPeriod !== "monthly"));
  const installments = splittable ? Math.min(Math.max(wanted, 1), ceiling) : 1;

  return { method, installments };
}
