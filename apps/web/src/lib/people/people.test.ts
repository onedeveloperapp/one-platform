import { exportLines, filterCount, readPeopleNumbers, readPeoplePage, readSegmentFilters } from "./people";
import { describe, expect, it } from "vitest";

import { globalHits, readPeopleSearch } from "@/lib/search/global-search";

// Every person and number here is invented.

describe("the firm's people", () => {
  it("reads a page of the list, the CPF said by its middle only", () => {
    const page = readPeoplePage({
      counts: { todos: 3, ativos: 1, "sem-caso-ativo": 2, "sem-marketing": 1 },
      total: 3,
      rows: [
        {
          id: "p1",
          name: "Maria Teste",
          cpf: "52998224725",
          city: "Goiânia",
          uf: "GO",
          active: true,
          has_case: true,
          adult: true,
        },
        { id: "p2", name: "", cpf: null },
      ],
    });
    expect(page.counts["sem-caso-ativo"]).toBe(2);
    expect(page.rows).toEqual([
      {
        id: "p1",
        name: "Maria Teste",
        cpfMiddle: "982.247",
        place: "Goiânia/GO",
        active: true,
        hasCase: true,
        adult: true,
        marketingOff: false,
        erased: false,
        point: null,
        reasons: [],
      },
    ]);
  });

  it("reads where each person stands in the funnel, and why one did not qualify", () => {
    const page = readPeoplePage({
      counts: { leads: 1, "nao-qualificados": 1 },
      total: 2,
      rows: [
        { id: "p1", name: "Maria Teste", point: "lead", reasons: [] },
        { id: "p2", name: "João Teste", point: "nao_qualificado", reasons: ["cancelled_early_notice", 3] },
        { id: "p3", name: "Ana Teste", point: "whatever" },
      ],
    });
    expect(page.counts.leads).toBe(1);
    expect(page.counts["nao-qualificados"]).toBe(1);
    expect(page.counts.clientes).toBe(0);
    expect(page.rows.map((row) => [row.point, row.reasons])).toEqual([
      ["lead", []],
      ["nao_qualificado", ["cancelled_early_notice"]],
      [null, []],
    ]);
  });

  it("reads the numbers, the origins from the largest and every age band", () => {
    const numbers = readPeopleNumbers({
      registered: 5,
      active: 3,
      origins: { referral: 1, agency: 3 },
      ages: { minor: 1, 60: 1 },
      outcomes: [{ key: "procedente", count: 1 }],
    });
    expect(numbers.origins.map((tally) => tally.key)).toEqual(["agency", "referral"]);
    expect(numbers.ages).toHaveLength(7);
    expect(numbers.ages.find((tally) => tally.key === "minor")?.count).toBe(1);
    expect(numbers.outcomes).toEqual([{ key: "procedente", count: 1 }]);
  });
});

describe("a segment", () => {
  it("keeps only the filters it may have, an empty list or an age of a minor being none", () => {
    expect(
      readSegmentFilters({
        origins: ["agency", ""],
        cities: [],
        ufs: ["go"],
        age_min: 15,
        age_max: 40,
        active: true,
        cpf: ["x"],
      }),
    ).toEqual({ origins: ["agency"], ufs: ["GO"], age_max: 40, active: true });
    expect(filterCount({ origins: ["agency"], age_max: 40 })).toBe(2);
  });

  it("writes the export's lines in the columns chosen", () => {
    expect(exportLines([{ nome: "Maria Teste", idade: 36, email: null }], ["nome", "email", "idade"])).toEqual([
      ["Maria Teste", "", 36],
    ]);
  });
});

describe("the search at the top", () => {
  it("lists people first, then cases, then conversations, each with where it opens", () => {
    const found = readPeopleSearch({
      people: [{ id: "p1", name: "Maria Teste", cpf: "52998224725", city: null, cases: 2, active: true }],
      conversations: [{ id: "w1", name: null, number: "5562999990001" }],
    });
    const hits = globalHits(found, [{ id: "c1", label: "#12", client: "Maria Teste", status: "filed" }]);
    expect(hits.map((hit) => [hit.kind, hit.href])).toEqual([
      ["person", "/pessoas/p1"],
      ["case", "/casos/c1"],
      ["conversation", "/atendimento?c=w1"],
    ]);
  });
});
