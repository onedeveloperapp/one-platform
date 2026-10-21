import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AsaasProvider } from "@flyee/billing/asaas";
import { type CheckoutInput, packCheckoutReference } from "@flyee/billing/types";

/**
 * One-off purchases on Asaas, against a fake Asaas: the kit, and a yearly plan
 * split into installments (docs/BILLING.md, "Parcelamento").
 *
 * The installment case is the bug the billing ladder fixed. Asaas has no
 * installments on a subscription, so a split yearly plan is ONE payment with
 * a parcel per month, and none of its webhooks names a subscription. The
 * purchase only activates if checkout returns the reference every parcel
 * carries (the installment id) and the parser hands that same reference to
 * the webhook. Either half missing, and a paid purchase never activates.
 */

const BASE = "https://fake.asaas.test/v3";
const ORG = "11111111-1111-4111-8111-111111111111";
const PLAN = "22222222-2222-4222-8222-222222222222";

type Route = (init?: RequestInit) => { status: number; body: unknown };
let routes: Record<string, Route>;
let calls: { method: string; path: string; body: Record<string, unknown> | null }[];

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  process.env.ASAAS_API_KEY = "test-key";
  process.env.ASAAS_BASE_URL = BASE;
  process.env.ASAAS_WEBHOOK_TOKEN = "webhook-token";
  calls = [];
  routes = {
    "GET /customers?externalReference": () => ({ status: 200, body: { data: [{ id: "cus_1" }] } }),
    "PUT /customers/cus_1": () => ({ status: 200, body: { id: "cus_1" } }),
    "POST /payments": () => ({
      status: 200,
      body: { id: "pay_1", invoiceUrl: "https://fake.asaas.test/i/pay_1", installment: "ins_1" },
    }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const path = url.replace(BASE, "");
      calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const key = Object.keys(routes).find((candidate) => {
        const [m, p] = candidate.split(" ");
        return m === method && path.startsWith(p);
      });
      if (!key) return respond(404, { errors: [{ description: `no fake for ${method} ${path}` }] });
      const { status, body } = routes[key](init);
      return respond(status, body);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const checkout = (
  overrides: Omit<Partial<CheckoutInput>, "plan"> & { plan?: Partial<CheckoutInput["plan"]> } = {},
): CheckoutInput => {
  const { plan, ...rest } = overrides;
  return {
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    orgId: ORG,
    orgName: "Ana",
    customerEmail: "ana@example.com",
    plan: {
      id: PLAN,
      slug: "club-anual",
      name: "Plano Escritório",
      kind: "recurring",
      period: "yearly",
      priceCents: 59700,
      currency: "BRL",
      trialDays: 0,
      description: null,
      ...plan,
    },
    modules: [],
    payer: { document: "37715687731" },
    paymentMethod: "credit_card",
    installments: 12,
    successUrl: "https://app.test/inicio?checkout=success",
    cancelUrl: "https://app.test/assinatura?checkout=canceled",
    ...rest,
  };
};

const paymentPosts = () => calls.filter((call) => call.method === "POST" && call.path.startsWith("/payments"));

describe("AsaasProvider.createCheckout — one-off purchases", () => {
  it("splits a yearly plan as ONE payment and returns the installment id as the purchase reference", async () => {
    const result = await new AsaasProvider().createCheckout(checkout());

    expect(result.providerPaymentId).toBe("ins_1");
    expect(result.providerSubscriptionId).toBeUndefined();
    expect(calls.some((call) => call.path.startsWith("/subscriptions"))).toBe(false);

    const [post] = paymentPosts();
    // The total, divided by Asaas; `value` would multiply the price by twelve.
    expect(post.body).toMatchObject({ totalValue: 597, installmentCount: 12, billingType: "CREDIT_CARD" });
    expect(post.body).not.toHaveProperty("value");
  });

  it("charges the kit once and returns the payment itself as the reference", async () => {
    routes["POST /payments"] = () => ({
      status: 200,
      body: { id: "pay_9", invoiceUrl: "https://fake.asaas.test/i/pay_9" },
    });
    const result = await new AsaasProvider().createCheckout(
      checkout({ installments: 1, plan: { slug: "kit", kind: "access", period: null, priceCents: 9700 } }),
    );

    expect(result.providerPaymentId).toBe("pay_9");
    expect(result.providerSubscriptionId).toBeUndefined();
    const [post] = paymentPosts();
    expect(post.body).toMatchObject({ value: 97 });
    expect(post.body).not.toHaveProperty("installmentCount");
  });

  it("refuses a USD plan before touching the provider", async () => {
    await expect(
      new AsaasProvider().createCheckout(checkout({ plan: { currency: "USD", priceCents: 19000 } })),
    ).rejects.toThrow("asaas_currency_unsupported");
    expect(calls).toHaveLength(0);
  });
});

describe("AsaasProvider.parseWebhook — matching a payment to its purchase", () => {
  const headers = { "asaas-access-token": "webhook-token" };
  const reference = packCheckoutReference({ org_id: ORG, plan_id: PLAN });
  const deliver = (payment: Record<string, unknown>, event = "PAYMENT_RECEIVED") =>
    new AsaasProvider().parseWebhook(JSON.stringify({ id: "evt_1", event, payment }), headers);

  it("hands every parcel of a split purchase the installment id, and no activation event", async () => {
    const events = await deliver({
      id: "pay_2",
      customer: "cus_1",
      installment: "ins_1",
      value: 49.75,
      externalReference: reference,
      paymentDate: "2026-10-01",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "payment_succeeded",
      providerPaymentRef: "ins_1",
      providerInvoiceId: "pay_2",
      amountCents: 4975,
      currency: "BRL",
      metadata: { org_id: ORG, plan_id: PLAN },
    });
  });

  it("references a single charge (the kit) by the payment itself", async () => {
    const events = await deliver({ id: "pay_9", customer: "cus_1", value: 97, externalReference: reference });
    expect(events[0]).toMatchObject({ type: "payment_succeeded", providerPaymentRef: "pay_9" });
  });

  it("gives a subscription cycle no purchase reference, and activates the subscription", async () => {
    const events = await deliver({
      id: "pay_3",
      customer: "cus_1",
      subscription: "sub_1",
      value: 67,
      externalReference: reference,
      dueDate: "2026-10-01",
    });

    expect(events.map((event) => event.type)).toEqual(["payment_succeeded", "subscription_activated"]);
    expect(events[0]).not.toHaveProperty("providerPaymentRef");
    expect(events[0]).toMatchObject({ providerSubscriptionId: "sub_1" });
  });

  it("carries the reference on a refused parcel too, so dunning finds the purchase", async () => {
    const events = await deliver(
      { id: "pay_4", customer: "cus_1", installment: "ins_1", value: 49.75, externalReference: reference },
      "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
    );
    expect(events[0]).toMatchObject({ type: "payment_failed", providerPaymentRef: "ins_1" });
  });
});
