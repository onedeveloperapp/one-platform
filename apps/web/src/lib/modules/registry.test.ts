import { describe, expect, it } from "vitest";

import { buildRegistry } from "@/lib/modules/build";
import {
  caseKindForModel,
  caseKindLabelKey,
  caseKindsOf,
  firmCaseKinds,
  isCaseKindOf,
  MODULES,
} from "@/lib/modules/registry";
import type { ModuleDefinition } from "@/lib/modules/types";
import {
  INCIDENT_FOR_MODEL,
  INCIDENT_KEY,
  INCIDENTS,
  PASSENGER_MODULE,
} from "@/modules/direito-do-passageiro/incidents";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

/** A module that exists only in this test: the core answers for it as for any other. */
const healthModule: ModuleDefinition = {
  key: "plano-de-saude-teste",
  nameKey: "module-test",
  caseKinds: [
    { key: "denied_procedure", labelKey: "test-kind-denied", forModel: "procedimento negado" },
    { key: "abusive_increase", labelKey: "test-kind-increase", forModel: "reajuste abusivo" },
  ],
};

describe("the modules installed", () => {
  it("has the passenger module with its kinds of problem, in their order, each with its words", () => {
    expect(MODULES.modules.map((definition) => definition.key)).toEqual([PASSENGER_MODULE]);
    expect(caseKindsOf(PASSENGER_MODULE).map((kind) => kind.key)).toEqual([...INCIDENTS]);
    for (const incident of INCIDENTS) {
      expect(caseKindLabelKey(incident)).toBe(INCIDENT_KEY[incident]);
      expect(caseKindForModel(incident)).toBe(INCIDENT_FOR_MODEL[incident]);
      expect(product[INCIDENT_KEY[incident]]).toBeTruthy();
    }
    expect(product[MODULES.modules[0].nameKey]).toBeTruthy();
  });

  it("answers nothing for what no module has", () => {
    expect(caseKindLabelKey("denied_procedure")).toBeNull();
    expect(caseKindLabelKey(null)).toBeNull();
    expect(caseKindForModel(undefined)).toBeNull();
    expect(isCaseKindOf(PASSENGER_MODULE, "denied_procedure")).toBe(false);
    expect(isCaseKindOf("modulo-que-nao-existe", "delay")).toBe(false);
    expect(caseKindsOf("modulo-que-nao-existe")).toEqual([]);
  });

  it("offers a firm the kinds of its own modules, and every module's with no firm to read", () => {
    expect(firmCaseKinds([PASSENGER_MODULE]).map((kind) => kind.key)).toEqual([...INCIDENTS]);
    expect(firmCaseKinds([])).toEqual([]);
    expect(firmCaseKinds(null).map((kind) => kind.key)).toEqual([...INCIDENTS]);
  });
});

describe("a module that exists only in the test", () => {
  const registry = buildRegistry([MODULES.modules[0], healthModule]);

  it("is asked through the same doors as the passenger module, without touching the core", () => {
    expect(registry.moduleOf("plano-de-saude-teste")?.nameKey).toBe("module-test");
    expect(registry.caseKindsOf("plano-de-saude-teste").map((kind) => kind.key)).toEqual([
      "denied_procedure",
      "abusive_increase",
    ]);
    expect(registry.isCaseKindOf("plano-de-saude-teste", "abusive_increase")).toBe(true);
    expect(registry.isCaseKindOf("plano-de-saude-teste", "delay")).toBe(false);
    expect(registry.caseKindLabelKey("denied_procedure")).toBe("test-kind-denied");
    expect(registry.caseKindForModel("abusive_increase")).toBe("reajuste abusivo");
    // A firm with only that module is offered only its kinds; one with both, the passenger's first.
    expect(registry.caseKindsOfFirm(["plano-de-saude-teste"]).map((kind) => kind.key)).toEqual([
      "denied_procedure",
      "abusive_increase",
    ]);
    expect(registry.caseKindsOfFirm([PASSENGER_MODULE, "plano-de-saude-teste"]).at(0)?.key).toBe(INCIDENTS[0]);
  });

  it("refuses two modules of one key and a kind two modules name", () => {
    expect(() => buildRegistry([healthModule, healthModule])).toThrow("module_twice:plano-de-saude-teste");
    expect(() =>
      buildRegistry([
        MODULES.modules[0],
        { ...healthModule, caseKinds: [{ key: "delay", labelKey: "x", forModel: "x" }] },
      ]),
    ).toThrow("case_kind_twice:delay");
  });
});
