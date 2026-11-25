import { areaChoicesFrom, scriptTypes } from "./area-choices";
import { describe, expect, it } from "vitest";

const laws = [
  { key: "passageiro", module: "direito-do-passageiro" },
  { key: "familia", module: null },
];

describe("the areas a person opens a case of", () => {
  it("offers an area of the firm's own under its latest published script, with its kinds in order", () => {
    const choices = areaChoicesFrom([{ id: "a1", name: "Família e sucessões", law_area: "familia" }], laws, [
      { area_id: "a1", version: 1, tipos: [{ chave: "divorcio", nome: "Divórcio consensual" }] },
      {
        area_id: "a1",
        version: 2,
        tipos: [
          { chave: "divorcio", nome: "Divórcio consensual" },
          { chave: "guarda", nome: "Guarda dos filhos" },
        ],
      },
    ]);
    expect(choices).toEqual([
      {
        id: "a1",
        name: "Família e sucessões",
        types: [
          { key: "divorcio", name: "Divórcio consensual" },
          { key: "guarda", name: "Guarda dos filhos" },
        ],
      },
    ]);
  });

  it("leaves out the area a module serves and an area with no script published", () => {
    const choices = areaChoicesFrom(
      [
        { id: "m1", name: "Direito do Passageiro", law_area: "passageiro" },
        { id: "a2", name: "Consumidor", law_area: null },
        { id: "a3", name: "Bancário", law_area: null },
      ],
      laws,
      [
        { area_id: "m1", version: 1, tipos: [{ chave: "atraso", nome: "Atraso" }] },
        { area_id: "a3", version: 1, tipos: [{ chave: "juros", nome: "Juros abusivos" }] },
      ],
    );
    expect(choices.map((choice) => choice.name)).toEqual(["Bancário"]);
  });

  it("reads only the kinds with a key and a name, once each", () => {
    expect(
      scriptTypes([
        { chave: "a", nome: "Um" },
        { chave: "a", nome: "Repetido" },
        { chave: "", nome: "Sem chave" },
        { chave: "b" },
        "solto",
      ]),
    ).toEqual([{ key: "a", name: "Um" }]);
    expect(scriptTypes(null)).toEqual([]);
  });
});
