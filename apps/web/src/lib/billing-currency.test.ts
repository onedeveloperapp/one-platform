import { normalizeCurrency, resolveCurrency } from "./billing-currency";
import { describe, expect, it } from "vitest";

describe("resolveCurrency", () => {
  it("follows the language when the visitor chose nothing", () => {
    expect(resolveCurrency({ locale: "pt-BR" })).toBe("BRL");
    expect(resolveCurrency({ locale: "en" })).toBe("USD");
    expect(resolveCurrency({})).toBe("BRL");
  });

  it("lets the visitor's choice win over the language", () => {
    expect(resolveCurrency({ cookie: "USD", locale: "pt-BR" })).toBe("USD");
    expect(resolveCurrency({ cookie: "brl", locale: "en" })).toBe("BRL");
  });

  it("ignores a currency we do not sell in", () => {
    expect(resolveCurrency({ cookie: "EUR", locale: "en" })).toBe("USD");
    expect(normalizeCurrency("<script>")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});
