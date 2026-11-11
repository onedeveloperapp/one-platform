import type {
  BillingEvent,
  CheckoutInput,
  CheckoutMetadata,
  CheckoutResult,
  PaymentProvider,
  PixCharge,
} from "@flyee/billing/types";
import { applyDiscount, packCheckoutReference, parseCheckoutReference } from "@flyee/billing/types";

/**
 * Asaas in memory, for development and tests: a checkout opens a customer and a subscription, a change of tier moves
 * its value, a cancellation sets its end, and the webhook reads the deliveries Asaas sends (its own envelope, checked
 * by the token), so the app runs the same path it runs against the real account. Deterministic: no clock, no
 * network.
 */
type FakeSubscription = {
  id: string;
  customer: string;
  valueCents: number;
  cycle: string;
  reference: string;
  endDate: string | null;
  deleted: boolean;
};

const CYCLE: Record<string, string> = { weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" };

export class FakeBillingProvider implements PaymentProvider {
  readonly name = "asaas" as const;
  readonly customers = new Map<string, { orgId: string; document: string }>();
  readonly subscriptions = new Map<string, FakeSubscription>();
  private readonly token: string;
  private sequence = 0;

  constructor(token = "fake-webhook-token") {
    this.token = token;
  }

  private next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(6, "0")}`;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (input.plan.currency.trim().toUpperCase() !== "BRL") throw new Error("asaas_currency_unsupported");
    const document = (input.payer?.document ?? "").replace(/\D/g, "");
    if (document.length !== 11 && document.length !== 14) throw new Error("asaas_missing_document");
    let customer = [...this.customers.entries()].find(([, entry]) => entry.orgId === input.orgId)?.[0];
    if (!customer) {
      customer = this.next("cus");
      this.customers.set(customer, { orgId: input.orgId, document });
    }
    const reference = packCheckoutReference({
      org_id: input.orgId,
      plan_id: input.plan.id,
      ...(input.coupon ? { coupon_id: input.coupon.id } : {}),
    });
    const recurring =
      input.plan.priceCents +
      input.modules.filter((module) => module.kind === "recurring").reduce((sum, module) => sum + module.priceCents, 0);
    if (input.plan.period === null) {
      const payment = this.next("pay");
      return { url: `https://asaas.invalid/i/${payment}`, providerCustomerId: customer, providerPaymentId: payment };
    }
    const id = this.next("sub");
    this.subscriptions.set(id, {
      id,
      customer,
      valueCents: applyDiscount(recurring, input.coupon),
      cycle: CYCLE[input.plan.period] ?? "MONTHLY",
      reference,
      endDate: null,
      deleted: false,
    });
    return { url: `https://asaas.invalid/i/${this.next("pay")}`, providerCustomerId: customer, providerSubscriptionId: id };
  }

  private subscription(id: string): FakeSubscription {
    const found = this.subscriptions.get(id);
    if (!found || found.deleted) throw new Error(`Asaas GET /subscriptions/${id} failed (404)`);
    return found;
  }

  async changeSubscription(input: { providerSubscriptionId: string; priceCents: number }): Promise<void> {
    if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) throw new Error("invalid_price");
    this.subscription(input.providerSubscriptionId).valueCents = input.priceCents;
  }

  async scheduleCancellation(providerSubscriptionId: string, currentPeriodEnd?: Date): Promise<{ currentPeriodEnd?: Date }> {
    if (!currentPeriodEnd) return {};
    const last = new Date(currentPeriodEnd);
    last.setDate(last.getDate() - 1);
    this.subscription(providerSubscriptionId).endDate = last.toISOString().slice(0, 10);
    return { currentPeriodEnd };
  }

  async resumeSubscription(providerSubscriptionId: string): Promise<void> {
    this.subscription(providerSubscriptionId).endDate = null;
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    this.subscription(providerSubscriptionId).deleted = true;
  }

  async pixCharge(): Promise<PixCharge | null> {
    return null;
  }

  async parseWebhook(rawBody: string, headers: Record<string, string | null>): Promise<BillingEvent[]> {
    if (headers["asaas-access-token"] !== this.token) throw new Error("Invalid asaas-access-token header");
    const body = JSON.parse(rawBody) as {
      id?: string;
      event: string;
      payment?: { id: string; customer: string; subscription?: string; value?: number; externalReference?: string; invoiceUrl?: string; paymentDate?: string };
      subscription?: { id: string; externalReference?: string };
    };
    const providerEventId = body.id ?? `${body.event}:${body.payment?.id ?? body.subscription?.id}`;
    const metadata: Partial<CheckoutMetadata> = parseCheckoutReference(
      body.payment?.externalReference ?? body.subscription?.externalReference,
    );
    const payment = body.payment;
    if ((body.event === "PAYMENT_CONFIRMED" || body.event === "PAYMENT_RECEIVED") && payment) {
      const amountCents = Math.round(Number(payment.value ?? 0) * 100);
      const events: BillingEvent[] = [
        {
          providerEventId,
          type: "payment_succeeded",
          provider: "asaas",
          metadata,
          providerSubscriptionId: payment.subscription,
          providerInvoiceId: payment.id,
          amountCents: Number.isFinite(amountCents) ? amountCents : 0,
          currency: "BRL",
          invoiceUrl: payment.invoiceUrl,
          paidAt: payment.paymentDate ? new Date(payment.paymentDate) : new Date(0),
        },
      ];
      if (payment.subscription) {
        events.push({
          providerEventId,
          type: "subscription_activated",
          provider: "asaas",
          metadata,
          providerCustomerId: payment.customer,
          providerSubscriptionId: payment.subscription,
          status: "active",
        });
      }
      return events;
    }
    if (body.event === "SUBSCRIPTION_DELETED" && body.subscription) {
      return [{ providerEventId, type: "subscription_canceled", provider: "asaas", providerSubscriptionId: body.subscription.id }];
    }
    return [];
  }
}
