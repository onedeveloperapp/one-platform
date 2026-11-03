import { describe, expect, it } from "vitest";

import { moduleSetupsOf, nextModuleSetup } from "@/lib/modules/module-setups";
import { moduleCatalogOf } from "@/lib/modules/offer";

const catalog = moduleCatalogOf([
  { key: "direito-do-passageiro", name: "Direito do Passageiro", status: "available", sort: 1, tone: "secondary" },
  { key: "plano-de-saude", name: "Plano de Saúde", status: "available", sort: 2, tone: "accent-2" },
  { key: "direito-trabalhista", name: "Direito Trabalhista", status: "coming_soon", sort: 3, tone: "accent-4" },
  { key: "modulo-sem-passos", name: "Módulo sem passos", status: "available", sort: 4 },
]);
const setupOf = (key: string) => (key === "modulo-sem-passos" ? null : `/configurar/${key}`);

describe("the setups of the modules a firm contracted", () => {
  it("lists only a contracted module that is out and has a setup of its own, in the catalog's order", () => {
    const setups = moduleSetupsOf(
      catalog,
      [
        { module_key: "plano-de-saude", setup_answered_at: null },
        { module_key: "direito-do-passageiro", setup_answered_at: "2026-11-03T12:00:00Z" },
        // A module to come is never set up, and one with nothing to set up has no setup.
        { module_key: "direito-trabalhista", setup_answered_at: null },
        { module_key: "modulo-sem-passos", setup_answered_at: null },
      ],
      setupOf,
    );
    expect(setups?.map((setup) => [setup.key, setup.answered, setup.tone])).toEqual([
      ["direito-do-passageiro", true, "secondary"],
      ["plano-de-saude", false, "accent-2"],
    ]);
  });

  it("opens the first one never answered, after the one just finished, else the home", () => {
    const setups = moduleSetupsOf(
      catalog,
      [
        { module_key: "direito-do-passageiro", setup_answered_at: null },
        { module_key: "plano-de-saude", setup_answered_at: null },
      ],
      setupOf,
    );
    expect(nextModuleSetup(setups)?.key).toBe("direito-do-passageiro");
    expect(nextModuleSetup(setups, "direito-do-passageiro")?.key).toBe("plano-de-saude");
    expect(nextModuleSetup(setups, "plano-de-saude")).toBeNull();
    // A read that failed opens no setup: never one not owed.
    expect(nextModuleSetup(null)).toBeNull();
    expect(moduleSetupsOf(null, [], setupOf)).toBeNull();
  });
});
