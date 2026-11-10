import { describe, expect, it } from "vitest";

import {
  holderCorrected,
  RELATION_KEY,
  relationInputOf,
  RESIDENCE_RELATIONS,
  residenceErrorKey,
  residenceStanding,
  residenceViewsOf,
} from "@/lib/cases/residence";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("the declaration of residence", () => {
  it("says where each declaration stands, by what keeps it from the filing and its envelope", () => {
    expect(residenceStanding("open", "residence_relation_missing", null)).toBe("asking");
    expect(residenceStanding("open", "residence_address_conflict", null)).toBe("conflict");
    expect(residenceStanding("open", "residence_declaration_unsigned", null)).toBe("issuing");
    expect(residenceStanding("open", "residence_declaration_unsigned", "pending")).toBe("signing");
    expect(residenceStanding("open", "residence_declaration_unsigned", "received")).toBe("signing");
    // An envelope that ended is ONE's to issue again, never "signing".
    expect(residenceStanding("open", "residence_declaration_unsigned", "refused")).toBe("issuing");
    expect(residenceStanding("open", "residence_declaration_unsigned", "expired")).toBe("issuing");
    expect(residenceStanding("open", null, "signed")).toBe("signed");
    expect(residenceStanding("waived", null, null)).toBe("waived");
  });

  it("reads what the database answered, leaving out what is not a declaration on the case", () => {
    const views = residenceViewsOf([
      {
        id: "d1",
        person_id: "p1",
        document_id: "doc1",
        holder: "Joana Teste",
        holder_read: "JOANA TESTE",
        relation: "mae",
        note: null,
        answered_source: "client",
        bill_city: "Goiânia",
        status: "open",
        blocker: "residence_declaration_unsigned",
        envelope: "pending",
        ended_reason: null,
      },
      { id: "d2", person_id: "p1", document_id: "doc2", holder: "Lia Teste", status: "void" },
      { id: "d3", person_id: "p1", holder: "Sem conta", status: "open" },
      {
        id: "d4",
        person_id: "p2",
        document_id: "doc4",
        holder: "Carlos Teste",
        relation: "tio",
        status: "waived",
        ended_reason: "Mora em Goiânia.",
      },
    ]);
    expect(views).toEqual([
      {
        id: "d1",
        personId: "p1",
        documentId: "doc1",
        holder: "Joana Teste",
        holderRead: "JOANA TESTE",
        relation: "mae",
        note: null,
        answeredBy: "client",
        billCity: "Goiânia",
        standing: "signing",
        endedReason: null,
      },
      expect.objectContaining({
        id: "d4",
        relation: null,
        holderRead: "Carlos Teste",
        standing: "waived",
        endedReason: "Mora em Goiânia.",
      }),
    ]);
    expect(residenceViewsOf(null)).toEqual([]);
  });

  it("tells a holder's name corrected from the same name written as a name", () => {
    expect(holderCorrected({ holder: "Joana Teste de Oliveira", holderRead: "JOANA TESTE DE OLIVEIRA" })).toBe(false);
    expect(holderCorrected({ holder: "José  Teste", holderRead: "JOSE TESTE" })).toBe(false);
    expect(holderCorrected({ holder: "Joana Teste", holderRead: "JOANA TESTE DE OLIVEIRA" })).toBe(true);
  });

  it("checks what a request to say who the holder is carries", () => {
    expect(relationInputOf({ relation: "mae", note: "ignorada", holder: "" })).toEqual({
      ok: true,
      relation: "mae",
      note: null,
      holder: "",
    });
    expect(relationInputOf({ relation: "outro", note: "  minha   tia ", holder: " Joana  Teste " })).toEqual({
      ok: true,
      relation: "outro",
      note: "minha tia",
      holder: "Joana Teste",
    });
    expect(relationInputOf({ relation: "outro", note: "x" })).toEqual({ ok: false, code: "note" });
    expect(relationInputOf({ relation: "tia" })).toEqual({ ok: false, code: "relation" });
    expect(relationInputOf({ relation: "pai", holder: "J" })).toEqual({ ok: false, code: "holder" });
    expect(relationInputOf(null)).toEqual({ ok: false, code: "relation" });
  });

  it("has words for every relation and refusal", () => {
    for (const relation of RESIDENCE_RELATIONS) expect(product[RELATION_KEY[relation]], relation).toBeTruthy();
    for (const code of [
      "relation",
      "note",
      "holder",
      "issued",
      "not_found",
      "not_allowed",
      "second_factor",
      "reason",
      "link_not_open",
      "x",
    ])
      expect(product[residenceErrorKey(code)], code).toBeTruthy();
  });
});
