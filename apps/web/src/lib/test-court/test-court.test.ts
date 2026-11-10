import { describe, expect, it } from "vitest";

import { receiptBlocks, stepOpen, stepWaits, testCourtViewOf, unitOf } from "@/lib/test-court/test-court";

// Every firm, person and number here is invented: the lawsuits are of 2099.

describe("the order of the test court", () => {
  it("distributes a lawsuit before anything else", () => {
    expect(stepOpen("distribuicao", [])).toBe(true);
    expect(stepOpen("audiencia", [])).toBe(false);
    expect(stepOpen("sentenca", [])).toBe(false);
    expect(stepOpen("audiencia", ["distribuicao"])).toBe(true);
    expect(stepOpen("manifestacao", ["distribuicao"])).toBe(true);
  });

  it("holds a hearing it set, makes final a judgment it gave and pays only a final one", () => {
    expect(stepOpen("audiencia_realizada", ["distribuicao"])).toBe(false);
    expect(stepOpen("audiencia_realizada", ["distribuicao", "audiencia"])).toBe(true);
    expect(stepOpen("transito", ["distribuicao"])).toBe(false);
    expect(stepOpen("alvara", ["distribuicao", "sentenca"])).toBe(false);
    expect(stepOpen("alvara", ["distribuicao", "sentenca", "transito"])).toBe(true);
    expect(stepOpen("arquivamento", ["distribuicao", "sentenca"])).toBe(true);
  });

  it("takes each step once, and nothing after the archiving", () => {
    expect(stepOpen("distribuicao", ["distribuicao"])).toBe(false);
    expect(stepOpen("manifestacao", ["distribuicao", "sentenca", "arquivamento"])).toBe(false);
  });

  it("holds a hearing from its moment, never before it", () => {
    const at = Date.parse("2099-10-27T13:15:00Z");
    expect(stepWaits("audiencia_realizada", at, at - 60_000)).toBe(true);
    expect(stepWaits("audiencia_realizada", at, at)).toBe(false);
    expect(stepWaits("audiencia_realizada", null, at)).toBe(false);
    expect(stepWaits("sentenca", at, at - 60_000)).toBe(false);
  });
});

describe("what the test court's page reads", () => {
  it("answers nothing for a link that opens nothing", () => {
    expect(testCourtViewOf({ found: false })).toBeNull();
    expect(testCourtViewOf(null)).toBeNull();
  });

  it("reads the packages to file and the lawsuits, leaving out what is not one", () => {
    const view = testCourtViewOf({
      found: true,
      firm: "Souza Advogados",
      packages: [
        {
          id: "p1",
          proceeding_id: "l1",
          case_seq: 1,
          client: "Mariana Teste",
          court: "TJGO",
          kind: "juizado",
          comarca: "Goiânia",
          files: 5,
          number: "50001231620998090001",
        },
        { id: "p2" },
      ],
      lawsuits: [
        {
          id: "l2",
          case_seq: 2,
          client: "Pedro Teste",
          cnj: "50001236020998090051",
          status: "filed",
          done: ["distribuicao", "audiencia", "outra-coisa"],
          hearing: "27/10/2026 às 15:30, presencial",
          hearing_at: "2026-10-27T18:30:00Z",
        },
        { id: "l4", cnj: "50001236020998090052", hearing_at: "27/10/2026 15:30" },
        { id: "l3" },
      ],
    });
    expect(view?.firm).toBe("Souza Advogados");
    expect(view?.packages).toHaveLength(1);
    expect(view?.packages[0]).toMatchObject({ caseSeq: 1, files: 5, number: "50001231620998090001" });
    expect(view?.lawsuits).toHaveLength(2);
    expect(view?.lawsuits[0].done).toEqual(["distribuicao", "audiencia"]);
    expect(view?.lawsuits[0].hearing).toBe("27/10/2026 às 15:30, presencial");
    expect(view?.lawsuits[0].hearingAt).toBe(Date.parse("2026-10-27T18:30:00Z"));
    expect(view?.lawsuits[1].hearingAt).toBeNull();
  });
});

describe("the receipt of a filing", () => {
  it("names the lawsuit's number as people write it, and says no court received it", () => {
    const blocks = receiptBlocks({
      firm: "Souza Advogados",
      number: "50001231620998090001",
      day: "26/10/2026",
      court: "TJGO",
      unit: unitOf("juizado", "Goiânia"),
      files: 5,
    });
    const written = JSON.stringify(blocks);
    expect(written).toContain("5000123-16.2099.8.09.0001");
    expect(written).toContain("1º Juizado Especial Cível da Comarca de Goiânia");
    expect(written).toContain("nenhum tribunal recebeu este processo");
  });

  it("judges a lawsuit one way only, and releases nothing of a judgment that denied the claim (0130)", () => {
    expect(stepOpen("sentenca_parcial", ["distribuicao"])).toBe(true);
    expect(stepOpen("acordo", ["distribuicao", "sentenca"])).toBe(false);
    expect(stepOpen("recurso_re", ["distribuicao"])).toBe(false);
    expect(stepOpen("recurso_re", ["distribuicao", "sentenca_parcial"])).toBe(true);
    expect(stepOpen("alvara", ["distribuicao", "acordo"])).toBe(true);
    expect(stepOpen("alvara", ["distribuicao", "sentenca_improcedente", "transito"])).toBe(false);
    expect(stepOpen("arquivamento", ["distribuicao", "sentenca_improcedente"])).toBe(true);
  });
});
