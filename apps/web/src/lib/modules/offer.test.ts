import { describe, expect, it } from "vitest";

import { moduleOfferOf } from "@/lib/modules/offer";

const catalog = [
  {
    key: "direito-trabalhista",
    name: "Direito Trabalhista",
    status: "coming_soon",
    sold_as: "package",
    description: "Reclamações trabalhistas em volume.",
    sort: 3,
    retired_at: null,
  },
  {
    key: "direito-do-passageiro",
    name: "Direito do Passageiro",
    status: "available",
    sold_as: "package",
    description: "Ações de passageiros aéreos.",
    sort: 1,
    retired_at: null,
  },
  {
    key: "direito-previdenciario",
    name: "Direito Previdenciário",
    status: "coming_soon",
    sold_as: "package",
    description: null,
    sort: 2,
    retired_at: null,
  },
  {
    key: "modulo-antigo",
    name: "Módulo antigo",
    status: "available",
    sold_as: "package",
    description: null,
    sort: 0,
    retired_at: "2026-10-01T00:00:00Z",
  },
];

describe("moduleOfferOf", () => {
  it("names what the firm contracted, with since when, and the modules to come in the catalog's order", () => {
    const offer = moduleOfferOf(catalog, [{ module_key: "direito-do-passageiro", enabled_at: "2026-10-29T12:00:00Z" }]);
    expect(offer?.contracted).toEqual([
      {
        key: "direito-do-passageiro",
        name: "Direito do Passageiro",
        description: "Ações de passageiros aéreos.",
        soldAs: "package",
        since: "2026-10-29T12:00:00Z",
      },
    ]);
    expect(offer?.comingSoon.map((module) => module.key)).toEqual(["direito-previdenciario", "direito-trabalhista"]);
  });

  it("counts no retired module as contracted, nor one that is not out", () => {
    const offer = moduleOfferOf(catalog, [
      { module_key: "modulo-antigo", enabled_at: "2026-09-01T00:00:00Z" },
      { module_key: "direito-trabalhista", enabled_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(offer?.contracted).toEqual([]);
  });

  it("leaves out a module whose state it does not know, and a firm with nothing has nothing", () => {
    const offer = moduleOfferOf([...catalog, { key: "novo", name: "Novo", status: "beta" }], []);
    expect(offer?.contracted).toEqual([]);
    expect(offer?.comingSoon.map((module) => module.key)).not.toContain("novo");
  });

  it("is null for what is not a list", () => {
    expect(moduleOfferOf(null, [])).toBeNull();
    expect(moduleOfferOf(catalog, { module_key: "x" })).toBeNull();
  });
});
