import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyForLocale, formatPrice, isBillingCurrency, providerNameForCurrency } from "./currency.ts";
import { ceilingsOf, enabledFeatures, hasEntitlement, isTierSlug, limitOf } from "./entitlements.ts";

describe("prices as people write them", () => {
  // Intl separates the symbol with a no-break space; compare words, not bytes.
  const read = (text: string) => text.replace(/\s/g, " ");

  it("prints a whole amount without decimals and cents always with two digits", () => {
    assert.equal(read(formatPrice(9700, "BRL", "pt-BR")), "R$ 97");
    assert.equal(read(formatPrice(7760, "BRL", "pt-BR")), "R$ 77,60");
    assert.equal(read(formatPrice(646, "BRL", "pt-BR")), "R$ 6,46");
  });

  it("never rounds a price away from what is charged", () => {
    assert.equal(read(formatPrice(9790, "BRL", "pt-BR")), "R$ 97,90");
  });
});

describe("currency routing", () => {
  it("routes reais to Asaas, whatever the casing", () => {
    assert.equal(providerNameForCurrency("BRL"), "asaas");
    assert.equal(providerNameForCurrency(" brl "), "asaas");
  });

  it("sells in no other currency", () => {
    assert.equal(providerNameForCurrency("USD"), null);
    assert.equal(providerNameForCurrency("EUR"), null);
    assert.equal(providerNameForCurrency(""), null);
    assert.equal(providerNameForCurrency(null), null);
    assert.equal(isBillingCurrency("brl"), false);
  });

  it("shows prices in reais whatever the page", () => {
    assert.equal(currencyForLocale("pt-BR"), "BRL");
    assert.equal(currencyForLocale("en"), "BRL");
    assert.equal(currencyForLocale(undefined), "BRL");
  });
});

describe("entitlements", () => {
  const essencial = { processos_ativos_max: 300, assentos_max: 5, whatsapp_numeros_max: 0, ignorado: "texto" };
  const rede = { processos_ativos_max: 3000, assentos_max: 30, whatsapp_numeros_max: 3, monitor_voo: 1 };

  it("reads numbers, and only numbers", () => {
    assert.equal(limitOf(essencial, "processos_ativos_max"), 300);
    assert.equal(limitOf(essencial, "ignorado"), 0);
    assert.equal(limitOf(essencial, "missing"), 0);
    assert.equal(limitOf(null, "assentos_max"), 0);
  });

  it("says whether a right is on", () => {
    assert.equal(hasEntitlement(rede, "monitor_voo"), true);
    assert.equal(hasEntitlement(essencial, "monitor_voo"), false);
    assert.equal(hasEntitlement(essencial, "whatsapp_numeros_max"), false);
  });

  it("lists a plan's ceilings and its rights, in order, leaving out what it does not set", () => {
    assert.deepEqual(ceilingsOf(essencial), [
      { key: "processos_ativos_max", value: 300 },
      { key: "assentos_max", value: 5 },
    ]);
    assert.deepEqual(enabledFeatures(rede), ["monitor_voo"]);
    assert.deepEqual(enabledFeatures(essencial), []);
  });

  it("takes a tier as data, any slug the operator writes", () => {
    assert.equal(isTierSlug("escritorio"), true);
    assert.equal(isTierSlug("Escritório"), false);
    assert.equal(isTierSlug(null), false);
  });
});
