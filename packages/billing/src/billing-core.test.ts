import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyForLocale, formatPrice, isBillingCurrency, providerNameForCurrency } from "./currency.ts";
import { enabledFeatures, hasEntitlement, limitOf, tierOf } from "./entitlements.ts";

describe("prices as people write them", () => {
  // Intl separates the symbol with a no-break space; compare words, not bytes.
  const read = (text: string) => text.replace(/\s/g, " ");

  it("prints a whole amount without decimals and cents always with two digits", () => {
    assert.equal(read(formatPrice(9700, "BRL", "pt-BR")), "R$ 97");
    assert.equal(read(formatPrice(7760, "BRL", "pt-BR")), "R$ 77,60");
    assert.equal(read(formatPrice(646, "BRL", "pt-BR")), "R$ 6,46");
    assert.equal(formatPrice(2900, "USD", "en"), "$29");
    assert.equal(formatPrice(2950, "USD", "en"), "$29.50");
  });

  it("never rounds a price away from what is charged", () => {
    assert.equal(read(formatPrice(9790, "BRL", "pt-BR")), "R$ 97,90");
    assert.equal(formatPrice(1999, "USD", "en"), "$19.99");
  });
});

describe("currency routing", () => {
  it("routes BRL to Asaas and USD to Stripe, whatever the casing", () => {
    assert.equal(providerNameForCurrency("BRL"), "asaas");
    assert.equal(providerNameForCurrency("usd"), "stripe");
    assert.equal(providerNameForCurrency(" Usd "), "stripe");
  });

  it("sells in no other currency", () => {
    assert.equal(providerNameForCurrency("EUR"), null);
    assert.equal(providerNameForCurrency(""), null);
    assert.equal(providerNameForCurrency(null), null);
    assert.equal(isBillingCurrency("brl"), false);
  });

  it("reads the currency from the page language", () => {
    assert.equal(currencyForLocale("pt-BR"), "BRL");
    assert.equal(currencyForLocale("en"), "USD");
    assert.equal(currencyForLocale(undefined), "BRL");
  });
});

describe("entitlements", () => {
  const kit = { catalog_access: 1, devices: 1, advanced_lessons: 0, update_channel: "latest" };
  const club = { catalog_access: 1, devices: 3, advanced_lessons: 1, recipes: 1, roadmap_vote: 1, meetings: 1 };

  it("reads numbers, and only numbers", () => {
    assert.equal(limitOf(kit, "devices"), 1);
    assert.equal(limitOf(kit, "update_channel"), 0);
    assert.equal(limitOf(kit, "missing"), 0);
    assert.equal(limitOf(null, "devices"), 0);
  });

  it("says whether a right is on", () => {
    assert.equal(hasEntitlement(kit, "catalog_access"), true);
    assert.equal(hasEntitlement(kit, "advanced_lessons"), false);
    assert.equal(hasEntitlement(club, "meetings"), true);
  });

  it("names the highest rung", () => {
    assert.equal(tierOf(["kit", "club"]), "club");
    assert.equal(tierOf(["pro", "kit", null]), "pro");
    assert.equal(tierOf([null, undefined, "free"]), null);
  });

  it("lists what a card shows, devices apart", () => {
    assert.deepEqual(enabledFeatures(kit), ["catalog_access"]);
    assert.deepEqual(enabledFeatures(club), ["catalog_access", "advanced_lessons", "recipes", "roadmap_vote", "meetings"]);
  });
});
