import { describe, expect, it } from "vitest";

import { filingFactsOf, type ToSend, tpuCodesOf } from "@/lib/court-robot/facts";

// Every person, number and address here is invented.
const SENT: ToSend = {
  submission_id: "s1",
  claim: 1,
  channel: "extension",
  batch_id: "b1",
  learning: true,
  screen_system: "pje-tjrj",
  org_id: "o1",
  case_id: "c1",
  incident: "cancellation",
  package_id: "p1",
  kind: "juizado",
  court: "TJRJ",
  court_state: "RJ",
  system: "pje",
  comarca: "Rio de Janeiro",
  unit: null,
  value_cents: null,
  claimants: [],
  defendant: null,
  lawyers: [],
  items: [],
};

const fact = (facts: ReturnType<typeof filingFactsOf>, key: string) => facts.fatos.find((item) => item.chave === key);

describe("the subjects of a lawsuit, as ONE's robot types them in a court's search (2026-11-26)", () => {
  it("reads the codes of the CNJ's table the platform keeps, and nothing that is not a code", () => {
    expect(tpuCodesOf({ subjects: { cancellation: 4830, delay: "4829", lost: -1 }, moral: 7779 })).toEqual({
      subjects: { cancellation: 4830 },
      moral: 7779,
    });
    expect(tpuCodesOf(null)).toEqual({ subjects: {}, moral: null });
  });

  it("gives the AI the code of each subject with its words, so the search goes by the code", () => {
    const facts = filingFactsOf(SENT, { subjects: { cancellation: 4830 }, moral: 7779 });
    expect(fact(facts, "processo.assunto_principal")?.valor).toBe("Cancelamento de voo (transporte aéreo)");
    expect(fact(facts, "processo.assunto_principal_codigo")).toEqual({
      chave: "processo.assunto_principal_codigo",
      descricao: "Código do assunto principal na tabela do CNJ",
      valor: "4830",
    });
    expect(fact(facts, "processo.assunto_complementar")?.descricao).toBe(
      "Assunto complementar (código 7779 na tabela do CNJ)",
    );
    expect(facts.values["processo.assunto_complementar_codigo"]).toBe("7779");
  });

  it("names a subject by its words only where the platform has no code for it, never a code guessed", () => {
    const facts = filingFactsOf(
      { ...SENT, incident: "missed_connection" },
      { subjects: { cancellation: 4830 }, moral: null },
    );
    expect(fact(facts, "processo.assunto_principal_codigo")).toBeUndefined();
    expect(fact(facts, "processo.assunto_complementar_codigo")).toBeUndefined();
    expect(fact(facts, "processo.assunto_complementar")?.descricao).toBe("Assunto complementar");
    expect(filingFactsOf(SENT).values).not.toHaveProperty("processo.assunto_principal_codigo");
  });
});
