# @flyee/billing

Per-workspace billing for flyee.club behind one `PaymentProvider` interface: **Asaas** charges BRL, **Stripe** charges USD, and the plan's currency decides which one runs. The full design (the ladder, grants versus subscriptions, the state machine, webhooks, installments, coupons, refunds, deferred items) lives in [`docs/BILLING.md`](../../docs/BILLING.md).

## Entry points

| Import | What it is |
|---|---|
| `@flyee/billing` | `providerForCurrency`, `getProvider`, `isPixAvailable`, the normalized `BillingEvent` types; re-exports the two pure modules below |
| `@flyee/billing/currency` | `BillingCurrency`, the currency-to-provider map, `currencyForLocale`. Pure, client-safe |
| `@flyee/billing/entitlements` | `ENTITLEMENT_KEYS`, `TIERS`, `hasEntitlement`, `limitOf`, `tierOf`, `enabledFeatures`. Pure, client-safe |
| `@flyee/billing/public` | `listPublicPlans({ currency })` for the public pricing page (anon, read-only) |
| `@flyee/billing/asaas`, `@flyee/billing/stripe` | the provider implementations |

## Model

The schema lives in `packages/db/migrations/0003_billing.sql` and `0004_entitlements.sql`:

- **Plans**: `access` (the kit, a one-time purchase) or `recurring` (membership and Pro, monthly or yearly), one row per currency. Rights are numeric keys of `plans.limits`. Prices are superadmin-managed data, never code.
- **Entitlement grants**: the kit and courtesies, created by the webhook on a paid invoice or by a superadmin.
- **Subscriptions**: one live row per workspace, with the price, currency and coupon it was sold at.
- **Coupons**: percent or fixed (fixed needs a currency), limited to plan families, always `forever`; uses counted by `redeem_coupon`.
- **Invoices**: the local mirror of provider charges.
- `org_entitlements(org)` is the one answer to "what may this workspace use".

## Providers

| Concern | Stripe (USD) | Asaas (BRL) |
|---|---|---|
| Kit | Checkout Session, `mode: "payment"` | one-off `/payments` charge, Pix or card |
| Membership and Pro | Checkout Session, `mode: "subscription"`, inline `price_data` | `/subscriptions` |
| Yearly in installments | not offered | one `/payments` charge with `installmentCount`, which does not renew |
| Coupons | mirrored coupon `flyee-<id>-<currency>`, `duration: forever` | discount applied to the charge value |
| Webhook auth | signature (`STRIPE_WEBHOOK_SECRET`) | shared token (`ASAAS_WEBHOOK_TOKEN`) |

Both parse webhooks into normalized `BillingEvent`s. Persistence lives in the app's webhook route (`apps/web/src/app/api/webhooks/[provider]/route.ts`), which runs with the service-role client.

## Env vars (apps/web)

```
STRIPE_SECRET_KEY=      STRIPE_WEBHOOK_SECRET=
ASAAS_API_KEY=          ASAAS_WEBHOOK_TOKEN=
ASAAS_BASE_URL=         # default: sandbox; https://api.asaas.com/v3 in production
BILLING_PIX_ENABLED=    # "false" hides Pix; empty asks the Asaas account
```

A currency whose provider has no key cannot be bought: the checkout answers `currency_unavailable`.

## Tests

`npm run test:billing` runs the pure currency and entitlement rules (`src/billing-core.test.ts`). The Asaas provider is tested against a fake Asaas in `apps/web/src/lib/asaas-pix.test.ts` and `asaas-installments.test.ts`.
