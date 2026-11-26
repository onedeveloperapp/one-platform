import { describe, expect, it } from "vitest";

import { asksInjunction, filingFactsOf, type ToSend, tpuCodesOf } from "@/lib/court-robot/facts";

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

const CLAIMANT = {
  name: "Marina Teste",
  cpf: "52998224725",
  birth_date: "1940-03-10",
  street: null,
  number: null,
  complement: null,
  district: null,
  city: null,
  state: null,
  zip: null,
  email: null,
  phone: null,
  guardian: null,
};

describe("what the court's screen asks of the lawsuit itself (the PJe of TJRJ's manual, 2026-11-26)", () => {
  it("in the small-claims court: no free justice asked, no costs, no secrecy, and an elderly claimant's priority", () => {
    const facts = filingFactsOf({ ...SENT, claimants: [CLAIMANT] }, null, {
      freeJustice: true,
      injunction: false,
      today: "2026-11-26",
    });
    expect(fact(facts, "processo.justica_gratuita")?.valor).toBe("Não");
    expect(fact(facts, "processo.liminar")?.valor).toBe("Não");
    expect(fact(facts, "processo.segredo_de_justica")?.valor).toBe("Não");
    expect(fact(facts, "processo.custas")?.valor).toContain("Lei 9.099/1995, art. 54");
    // The kind of priority only: never the age nor the name.
    expect(fact(facts, "processo.prioridade")?.valor).toBe("Idoso com mais de 80 anos");
    expect(JSON.stringify(facts.fatos)).not.toContain("1940");
    expect(JSON.stringify(facts.fatos)).not.toContain("86");
  });

  it("in the civil court: free justice as the claimants answered, and what is unknown left for the lawyer", () => {
    const asked = filingFactsOf(
      { ...SENT, kind: "comum", claimants: [{ ...CLAIMANT, birth_date: "1990-01-01" }] },
      null,
      { freeJustice: true, injunction: null, today: "2026-11-26" },
    );
    expect(fact(asked, "processo.justica_gratuita")?.valor).toBe("Sim");
    expect(fact(asked, "processo.custas")?.valor).toBe("Sem guia: a ação pede justiça gratuita");
    expect(fact(asked, "processo.liminar")).toBeUndefined();
    expect(fact(asked, "processo.prioridade")).toBeUndefined();
    const unknown = filingFactsOf({ ...SENT, kind: "comum" });
    expect(fact(unknown, "processo.justica_gratuita")).toBeUndefined();
    expect(fact(unknown, "processo.custas")).toBeUndefined();
  });

  it("reads an injunction asked from the petition's words, and nothing from no text", () => {
    expect(asksInjunction("Requer a concessão de tutela de urgência para ...")).toBe(true);
    expect(asksInjunction("Requer a citação da ré e a condenação ao pagamento de indenização.")).toBe(false);
    expect(asksInjunction("")).toBeNull();
    expect(asksInjunction(null)).toBeNull();
  });
});
