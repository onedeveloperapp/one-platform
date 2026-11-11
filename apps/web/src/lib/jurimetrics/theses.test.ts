import { describe, expect, it } from "vitest";

import { catalogOf, thesisOf } from "@/lib/jurimetrics/theses";

const catalog = catalogOf([
  { slug: "fortuito_interno", position: 10, patterns: ["fortuito interno", "risco da atividade"] },
  { slug: "forca_maior_clima", position: 40, patterns: ["condicoes meteorologicas", "forca maior"] },
  { slug: "quebrado", position: 50, patterns: ["(sem fechar"] },
  { nada: true },
]);

describe("the theses read by rule (teses-v1)", () => {
  it("reads the first thesis of the catalog the grounds hold, accents and case aside", () => {
    expect(thesisOf("A manutenção é FORTUITO INTERNO, risco da atividade da ré.", catalog)).toBe("fortuito_interno");
    expect(thesisOf("Comprovadas as condições meteorológicas adversas.", catalog)).toBe("forca_maior_clima");
  });

  it("reads none where the catalog's words are not there, and skips a pattern that is no expression", () => {
    expect(thesisOf("Julgo procedente o pedido.", catalog)).toBeNull();
    expect(thesisOf("", catalog)).toBeNull();
    expect(catalog).toHaveLength(3);
  });
});
