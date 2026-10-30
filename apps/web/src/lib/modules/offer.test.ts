import { describe, expect, it } from "vitest";

import { moduleCatalogOf, moduleMenuOf, moduleOfferOf, moduleScopeOf, scopedHref } from "@/lib/modules/offer";

const rows = [
  {
    key: "direito-trabalhista",
    name: "Direito Trabalhista",
    status: "coming_soon",
    sold_as: "package",
    description: "Reclamações trabalhistas em volume.",
    sort: 3,
    icon: "NiHardHat",
    retired_at: null,
  },
  {
    key: "direito-do-passageiro",
    name: "Direito do Passageiro",
    status: "available",
    sold_as: "package",
    description: "Ações de passageiros aéreos.",
    sort: 1,
    icon: "NiPlane",
    retired_at: null,
  },
  {
    key: "direito-previdenciario",
    name: "Direito Previdenciário",
    status: "coming_soon",
    sold_as: "package",
    description: null,
    sort: 2,
    icon: "NiUmbrella",
    retired_at: null,
  },
  {
    key: "modulo-antigo",
    name: "Módulo antigo",
    status: "available",
    sold_as: "package",
    description: null,
    sort: 0,
    icon: null,
    retired_at: "2026-10-01T00:00:00Z",
  },
  {
    key: "modulo-novo",
    name: "Módulo novo",
    status: "available",
    sold_as: "package",
    description: null,
    sort: 4,
    icon: "aviao.svg",
    retired_at: null,
  },
];

const catalog = moduleCatalogOf(rows);

describe("moduleCatalogOf", () => {
  it("keeps the modules out and to come in the catalog's order, never one retired", () => {
    expect(catalog?.map((module) => module.key)).toEqual([
      "direito-do-passageiro",
      "direito-previdenciario",
      "direito-trabalhista",
      "modulo-novo",
    ]);
  });

  it("keeps an icon only when it is a name of the app's set", () => {
    expect(catalog?.find((module) => module.key === "direito-do-passageiro")?.icon).toBe("NiPlane");
    expect(catalog?.find((module) => module.key === "modulo-novo")?.icon).toBeNull();
  });

  it("leaves out a module whose state it does not know, and is null for what is not a list", () => {
    expect(moduleCatalogOf([...rows, { key: "beta", name: "Beta", status: "beta" }])?.map((m) => m.key)).not.toContain(
      "beta",
    );
    expect(moduleCatalogOf(null)).toBeNull();
  });
});

describe("moduleOfferOf", () => {
  it("names what the firm contracted, with since when, the modules to come and the ones it could add", () => {
    const offer = moduleOfferOf(catalog, [{ module_key: "direito-do-passageiro", enabled_at: "2026-10-29T12:00:00Z" }]);
    expect(offer?.contracted).toEqual([
      {
        key: "direito-do-passageiro",
        name: "Direito do Passageiro",
        description: "Ações de passageiros aéreos.",
        icon: "NiPlane",
        soldAs: "package",
        since: "2026-10-29T12:00:00Z",
      },
    ]);
    expect(offer?.comingSoon.map((module) => module.key)).toEqual(["direito-previdenciario", "direito-trabalhista"]);
    expect(offer?.locked.map((module) => module.key)).toEqual(["modulo-novo"]);
  });

  it("counts no retired module as contracted, nor one that is not out", () => {
    const offer = moduleOfferOf(catalog, [
      { module_key: "modulo-antigo", enabled_at: "2026-09-01T00:00:00Z" },
      { module_key: "direito-trabalhista", enabled_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(offer?.contracted).toEqual([]);
  });

  it("is null for a catalog not read, or a firm's rows that are not a list", () => {
    expect(moduleOfferOf(null, [])).toBeNull();
    expect(moduleOfferOf(catalog, { module_key: "x" })).toBeNull();
  });
});

describe("moduleMenuOf", () => {
  it("says where each module stands for the firm, in the catalog's order", () => {
    expect(moduleMenuOf(catalog, ["direito-do-passageiro"])).toEqual([
      { key: "direito-do-passageiro", name: "Direito do Passageiro", icon: "NiPlane", state: "contracted" },
      { key: "direito-previdenciario", name: "Direito Previdenciário", icon: "NiUmbrella", state: "soon" },
      { key: "direito-trabalhista", name: "Direito Trabalhista", icon: "NiHardHat", state: "soon" },
      { key: "modulo-novo", name: "Módulo novo", icon: null, state: "locked" },
    ]);
  });

  it("lists nothing when the catalog could not be read", () => {
    expect(moduleMenuOf(null, ["direito-do-passageiro"])).toEqual([]);
  });

  it("never calls a module to come contracted, whatever the firm's rows say", () => {
    expect(moduleMenuOf(catalog, ["direito-trabalhista"]).find((m) => m.key === "direito-trabalhista")?.state).toBe(
      "soon",
    );
  });
});

describe("moduleScopeOf", () => {
  it("scopes a page only to a module the firm works in", () => {
    expect(moduleScopeOf("direito-do-passageiro", ["direito-do-passageiro"])).toBe("direito-do-passageiro");
    expect(moduleScopeOf("direito-trabalhista", ["direito-do-passageiro"])).toBeNull();
    expect(moduleScopeOf(["direito-do-passageiro", "x"], ["direito-do-passageiro"])).toBe("direito-do-passageiro");
  });

  it("refuses what is not a module's key", () => {
    expect(moduleScopeOf("../casos", ["../casos"])).toBeNull();
    expect(moduleScopeOf(undefined, ["direito-do-passageiro"])).toBeNull();
    expect(moduleScopeOf("", [""])).toBeNull();
  });
});

describe("scopedHref", () => {
  it("writes the address of a page under a module, or for every module", () => {
    expect(scopedHref("/prazos", "direito-do-passageiro", { ver: "vencidos" })).toBe(
      "/prazos?ver=vencidos&modulo=direito-do-passageiro",
    );
    expect(scopedHref("/prazos", null, { ver: "vencidos", pagina: null })).toBe("/prazos?ver=vencidos");
    expect(scopedHref("/agenda", null)).toBe("/agenda");
  });
});
