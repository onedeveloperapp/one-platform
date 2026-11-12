import { describe, expect, it } from "vitest";

import {
  factClaimsOf,
  factValue,
  lawsuitFactsOf,
  lawsuitOutcome,
  outcomeAttentionItems,
  outcomeAttentionOf,
} from "@/lib/cases/outcomes";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("what each lawsuit came to (0130)", () => {
  const facts = lawsuitFactsOf([
    {
      id: "1",
      proceeding_id: "p",
      kind: "sentenca",
      result: "procedente",
      cents: 500000,
      per_claimant: true,
      happened_on: "2026-10-01",
      by_one: true,
      confirmed: true,
    },
    {
      id: "2",
      proceeding_id: "p",
      kind: "transito",
      happened_on: "2026-10-20",
      by_one: true,
      confirmed: true,
      ack_owed: true,
    },
    {
      id: "3",
      proceeding_id: "p",
      kind: "arquivamento",
      happened_on: "2026-11-01",
      corrected_at: "2026-11-02",
      corrected_reason: "Era outro processo.",
    },
    { id: "4", proceeding_id: "p", kind: "nope" },
  ]);

  it("reads the facts, leaving out what it does not know", () => {
    expect(facts.map((fact) => fact.kind)).toEqual(["sentenca", "transito", "arquivamento"]);
    expect(facts[2].corrected).toBe(true);
  });

  it("says where a lawsuit stands by its facts in force, a corrected one counting for nothing", () => {
    expect(lawsuitOutcome(facts)).toBe("final");
    expect(lawsuitOutcome([])).toBe("open");
    expect(factValue(facts[0])).toBe("R$ 5.000,00 por autor");
  });

  it("lists what the results ask of a person, each one click from its case", () => {
    const attention = outcomeAttentionOf({
      acks: [
        { fact_id: "a", case_id: "c1", seq: 7, kind: "transito" },
        { fact_id: "b", case_id: "c2", seq: 8, kind: "sentenca", result: "improcedente" },
        // An acórdão against the client, and one the rule could not tell for whom (0225).
        { fact_id: "d", case_id: "c6", seq: 12, kind: "acordao", result: "improcedente" },
        { fact_id: "e", case_id: "c7", seq: 13, kind: "acordao", result: null },
      ],
      unconfirmed: [{ fact_id: "u", case_id: "c3", seq: 9, kind: "arquivamento" }],
      releases: [{ fact_id: "r", case_id: "c1", seq: 7, cents: 1000000 }],
      ready_to_close: [{ case_id: "c4", seq: 10 }],
      closed_by_one: [{ case_id: "c5", seq: 11 }],
    });
    const items = outcomeAttentionItems(attention!);
    expect(items.map((item) => [item.label.key, item.href])).toEqual([
      ["pending-outcome-final", "/casos/c1#resultado"],
      ["pending-outcome-against", "/casos/c2#resultado"],
      ["pending-outcome-acordao-against", "/casos/c6#resultado"],
      ["pending-outcome-acordao", "/casos/c7#resultado"],
      ["pending-outcome-release", "/casos/c1#resultado"],
      ["pending-outcome-unconfirmed", "/casos/c3#resultado"],
      ["pending-outcome-ready", "/casos/c4#resultado"],
      ["pending-outcome-closed", "/casos/c5#resultado"],
    ]);
    for (const item of items) {
      expect(product[item.label.key], item.label.key).toBeTruthy();
      if (item.detail) expect(product[item.detail.key], item.detail.key).toBeTruthy();
    }
    expect(outcomeAttentionOf(null)).toBeNull();
  });
});

describe("the result of each claim of a judgment (0193)", () => {
  it("reads each claim the database keeps, leaving out what it does not know", () => {
    expect(
      factClaimsOf([
        { claim: "danos_morais", result: "concedido", cents: 500000, per_claimant: true },
        { claim: "danos_materiais", result: "negado", cents: 90000, per_claimant: true },
        { claim: "honra", result: "concedido" },
        { claim: "restituicao", result: "talvez" },
        null,
      ]),
    ).toEqual([
      { claim: "danos_morais", result: "concedido", cents: 500000, perClaimant: true },
      { claim: "danos_materiais", result: "negado", cents: null, perClaimant: false },
    ]);
    expect(factClaimsOf(null)).toEqual([]);
  });

  it("gives a judgment its claims, and any other fact none", () => {
    const [judgment, final] = lawsuitFactsOf([
      {
        id: "1",
        proceeding_id: "p",
        kind: "sentenca",
        result: "parcial",
        happened_on: "2026-10-01",
        claims: [{ claim: "lucros_cessantes", result: "negado" }],
      },
      { id: "2", proceeding_id: "p", kind: "transito", happened_on: "2026-10-20", claims: [{ claim: "danos_morais" }] },
    ]);
    expect(judgment.claims).toEqual([{ claim: "lucros_cessantes", result: "negado", cents: null, perClaimant: false }]);
    expect(final.claims).toEqual([]);
  });
});
