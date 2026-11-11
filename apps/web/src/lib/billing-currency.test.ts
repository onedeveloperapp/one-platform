import { normalizeCurrency, resolveCurrency } from "./billing-currency";
import { describe, expect, it } from "vitest";

describe("resolveCurrency", () => {
  it("is reais whatever the language, the one currency ONE sells in", () => {
    expect(resolveCurrency({ locale: "pt-BR" })).toBe("BRL");
    expect(resolveCurrency({ locale: "en" })).toBe("BRL");
    expect(resolveCurrency({})).toBe("BRL");
  });

  it("takes no other currency from a link or a cookie", () => {
    expect(resolveCurrency({ cookie: "USD", locale: "pt-BR" })).toBe("BRL");
    expect(resolveCurrency({ cookie: "brl", locale: "en" })).toBe("BRL");
    expect(resolveCurrency({ cookie: "EUR", locale: "en" })).toBe("BRL");
    expect(normalizeCurrency("USD")).toBeNull();
    expect(normalizeCurrency("<script>")).toBeNull();
    expect(normalizeCurrency(null)).toBeNull();
  });
});
