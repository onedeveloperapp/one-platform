import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeBillingProvider } from "./fake.ts";
import { AsaasProvider } from "./providers/asaas.ts";
import type { CheckoutInput, PaymentProvider } from "./types.ts";

/**
 * What any provider of ONE's subscription must do: open a subscription from a checkout, change its value when the
 * firm changes its tier, set and lift its end, and read Asaas's deliveries only with the account's token. Run against
 * the fake and against the real client talking to a stand-in in the shapes of Asaas's reference (read on
 * 2026-11-11). Every firm, plan and number here is invented.
 */

const ORG = "11111111-2222-4333-8444-555555555555";
const PLAN = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const TOKEN = "token-de-teste";

const checkout = (overrides: Partial<CheckoutInput> = {}): CheckoutInput => ({
  idempotencyKey: "op-1",
  orgId: ORG,
  orgName: "Lima Advocacia",
  customerEmail: "ana@lima.invalid",
  plan: { id: PLAN, slug: "escritorio-mensal", name: "Escritório", kind: "recurring", period: "monthly", priceCents: 99000, currency: "BRL", trialDays: 0 },
  modules: [],
  successUrl: "https://one.invalid/settings/billing",
  cancelUrl: "https://one.invalid/settings/billing",
  payer: { document: "529.982.247-25", postalCode: "74000-000", addressNumber: "10" },
  paymentMethod: "credit_card",
  ...overrides,
});

type Harness = {
  provider: PaymentProvider;
  valueOf: (subscription: string) => number | undefined;
  endOf: (subscription: string) => string | null | undefined;
};

function contract(name: string, make: () => Harness) {
  describe(`billing provider contract: ${name}`, () => {
    it("opens a subscription from a checkout, with its payment page, customer and value", async () => {
      const { provider, valueOf } = make();
      const result = await provider.createCheckout(checkout());
      assert.match(result.url, /^https:\/\//);
      assert.ok(result.providerCustomerId);
      assert.ok(result.providerSubscriptionId);
      assert.equal(valueOf(result.providerSubscriptionId), 99000);
    });

    it("refuses a currency ONE does not sell in, and a payer with no document", async () => {
      const { provider } = make();
      await assert.rejects(provider.createCheckout(checkout({ plan: { ...checkout().plan, currency: "USD" } })));
      await assert.rejects(provider.createCheckout(checkout({ payer: { document: "123" } })));
    });

    it("changes the subscription's value when the firm changes its tier", async () => {
      const { provider, valueOf } = make();
      const { providerSubscriptionId } = await provider.createCheckout(checkout());
      assert.ok(providerSubscriptionId);
      await provider.changeSubscription({ providerSubscriptionId, priceCents: 199000 });
      assert.equal(valueOf(providerSubscriptionId), 199000);
      await assert.rejects(provider.changeSubscription({ providerSubscriptionId, priceCents: 0 }));
    });

    it("sets the subscription's last day and lifts it", async () => {
      const { provider, endOf } = make();
      const { providerSubscriptionId } = await provider.createCheckout(checkout());
      assert.ok(providerSubscriptionId);
      await provider.scheduleCancellation(providerSubscriptionId, new Date("2026-12-10T12:00:00Z"));
      assert.equal(endOf(providerSubscriptionId), "2026-12-09");
      await provider.resumeSubscription(providerSubscriptionId);
      assert.equal(endOf(providerSubscriptionId), null);
    });

    it("reads a paid charge of the subscription, and no delivery without the account's token", async () => {
      const { provider } = make();
      const { providerSubscriptionId } = await provider.createCheckout(checkout());
      const raw = JSON.stringify({
        id: "evt_1",
        event: "PAYMENT_CONFIRMED",
        payment: {
          id: "pay_9",
          customer: "cus_x",
          subscription: providerSubscriptionId,
          value: 990,
          externalReference: `${ORG.replace(/-/g, "")}.${PLAN.replace(/-/g, "")}`,
          paymentDate: "2026-11-11",
        },
      });
      const events = await provider.parseWebhook(raw, { "asaas-access-token": TOKEN });
      const paid = events.find((event) => event.type === "payment_succeeded");
      assert.ok(paid && paid.type === "payment_succeeded");
      assert.equal(paid.amountCents, 99000);
      assert.equal(paid.providerSubscriptionId, providerSubscriptionId);
      assert.equal(paid.metadata.org_id, ORG);
      assert.equal(paid.metadata.plan_id, PLAN);
      await assert.rejects(provider.parseWebhook(raw, { "asaas-access-token": "outro" }));
    });
  });
}

contract("fake", () => {
  const provider = new FakeBillingProvider(TOKEN);
  return {
    provider,
    valueOf: (id) => provider.subscriptions.get(id)?.valueCents,
    endOf: (id) => provider.subscriptions.get(id)?.endDate,
  };
});

/** Asaas in the shapes of its reference: customers, subscriptions, their first charge, an update and a removal. */
function asaasStandIn() {
  const subscriptions = new Map<string, { value: number; endDate: string | null }>();
  let sequence = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const path = url.pathname.replace(/^\/v3/, "");
    if (path === "/customers" && method === "GET") return json({ data: [] });
    if (path === "/customers" && method === "POST") return json({ id: "cus_000001" });
    if (path === "/subscriptions" && method === "POST") {
      sequence += 1;
      const id = `sub_${String(sequence).padStart(6, "0")}`;
      subscriptions.set(id, { value: Number(body.value), endDate: null });
      return json({ id });
    }
    const one = /^\/subscriptions\/([^/]+)(\/payments)?$/.exec(path);
    if (one) {
      const subscription = subscriptions.get(one[1] ?? "");
      if (!subscription) return json({ errors: [{ code: "invalid_action", description: "Assinatura inexistente." }] }, 404);
      if (one[2] && method === "GET") return json({ data: [{ id: `pay_${one[1]}`, invoiceUrl: `https://sandbox.asaas.invalid/i/${one[1]}` }] });
      if (method === "PUT") {
        if ("value" in body) subscription.value = Number(body.value);
        if ("endDate" in body) subscription.endDate = (body.endDate as string | null) ?? null;
        return json({ id: one[1] });
      }
      if (method === "DELETE") {
        subscriptions.delete(one[1] ?? "");
        return json({ deleted: true, id: one[1] });
      }
    }
    return json({ errors: [{ code: "not_found", description: "Rota inexistente." }] }, 404);
  };
  return { fetcher: fetcher as typeof fetch, subscriptions };
}

contract("Asaas", () => {
  const server = asaasStandIn();
  process.env.ASAAS_API_KEY = "chave-de-teste";
  process.env.ASAAS_BASE_URL = "https://asaas.invalid/v3";
  process.env.ASAAS_WEBHOOK_TOKEN = TOKEN;
  globalThis.fetch = server.fetcher;
  return {
    provider: new AsaasProvider(),
    valueOf: (id) => {
      const value = server.subscriptions.get(id)?.value;
      return value === undefined ? undefined : Math.round(value * 100);
    },
    endOf: (id) => server.subscriptions.get(id)?.endDate,
  };
});
