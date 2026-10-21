import { describe, expect, it } from "vitest";

import ptBR from "@flyee/content/messages/pt-BR.json";

/**
 * ONE ships one catalog, in Portuguese. Every catalog listed here must hold
 * the SAME keys as it: there is no `getMessageFallback` configured, so a key
 * missing in a language does not fail the build or the page, it prints the
 * key path on screen. With a single catalog the comparisons have nothing to
 * compare and only the blank-string check binds; a second language is added
 * to `CATALOGS` and they bind again.
 */

const CATALOGS: Record<string, Record<string, Record<string, string>>> = {
  "pt-BR": ptBR,
};

const NAMESPACES = ["product", "auth", "dashboard", "marketing"];

describe("message catalogs", () => {
  const reference = CATALOGS["pt-BR"];

  it("holds every namespace the app reads", () => {
    expect(Object.keys(reference).sort()).toEqual([...NAMESPACES].sort());
    for (const namespace of NAMESPACES) expect(Object.keys(reference[namespace]).length).toBeGreaterThan(0);
  });

  it.each(NAMESPACES)("%s has the same keys in every locale", (namespace) => {
    const expected = Object.keys(reference[namespace] ?? {}).sort();

    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      if (locale === "pt-BR") continue;
      const actual = Object.keys(catalog[namespace] ?? {}).sort();
      const missing = expected.filter((key) => !actual.includes(key));
      const extra = actual.filter((key) => !expected.includes(key));

      expect({ locale, missing, extra }).toEqual({ locale, missing: [], extra: [] });
    }
  });

  it("never ships an empty string as a text", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const namespace of NAMESPACES) {
        const blank = Object.entries(catalog[namespace] ?? {})
          .filter(([, value]) => typeof value === "string" && value.trim() === "")
          .map(([key]) => key);
        expect({ locale, namespace, blank }).toEqual({ locale, namespace, blank: [] });
      }
    }
  });

  it("keeps the same ICU placeholders in every locale", () => {
    // A dropped {count} is invisible until the sentence renders without the
    // number that made it a sentence.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)].map((match) => match[1]).sort();

    for (const namespace of NAMESPACES) {
      for (const [key, value] of Object.entries(reference[namespace] ?? {})) {
        if (typeof value !== "string") continue;
        const expected = [...new Set(placeholders(value))];
        if (expected.length === 0) continue;

        for (const [locale, catalog] of Object.entries(CATALOGS)) {
          if (locale === "pt-BR") continue;
          const translated = catalog[namespace]?.[key];
          if (typeof translated !== "string") continue;
          expect({ locale, key, names: [...new Set(placeholders(translated))] }).toEqual({
            locale,
            key,
            names: expected,
          });
        }
      }
    }
  });
});
