// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  DECISION_KEY,
  decisionsAfterAcordao,
  judgmentPathsOf,
  recommendAfterAcordao,
  recommendPath,
} from "@/lib/cases/judgment-paths";
import messages from "@flyee/content/messages/pt-BR.json";

describe("what may follow a judgment and an acórdão (0185, 0225)", () => {
  it("reads each path with the stage it follows, a decision it does not know left out", () => {
    expect(
      judgmentPathsOf([
        { id: "a", proceeding_id: "p", fact_id: "f1", decision: "recurso_inominado" },
        { id: "b", proceeding_id: "p", fact_id: "f2", stage: "acordao", decision: "reclamacao" },
        { id: "c", proceeding_id: "p", fact_id: "f3", stage: "acordao", decision: "outra" },
      ]).map((path) => [path.id, path.stage, path.decision]),
    ).toEqual([
      ["a", "sentenca", "recurso_inominado"],
      ["b", "acordao", "reclamacao"],
      ["c", "acordao", null],
    ]);
  });

  it("offers the reclamação after an acórdão of the small-claims court, the special appeal after one of the civil court", () => {
    expect(decisionsAfterAcordao("juizado")).toEqual([
      "aceitar",
      "embargos_declaracao",
      "recurso_extraordinario",
      "reclamacao",
    ]);
    expect(decisionsAfterAcordao("comum")).toEqual([
      "aceitar",
      "embargos_declaracao",
      "recurso_especial",
      "recurso_extraordinario",
    ]);
  });

  it("recommends accepting an acórdão in the client's favour, and nothing for one against or unknown", () => {
    expect(recommendAfterAcordao("procedente")).toBe("aceitar");
    expect(recommendAfterAcordao("parcial")).toBe("aceitar");
    expect(recommendAfterAcordao("improcedente")).toBeNull();
    expect(recommendAfterAcordao(null)).toBeNull();
    expect(recommendPath({ kind: "juizado", result: "improcedente", requestedCents: null, grantedCents: null })).toBe(
      "recurso_inominado",
    );
  });

  it("has words for every decision", () => {
    const words = messages.product as Record<string, string>;
    for (const key of Object.values(DECISION_KEY)) expect(words[key], key).toBeTruthy();
  });
});
