import { lawsuitSignsOf, xrayOf } from "./xray";
import { describe, expect, it } from "vitest";

import type { DjenCommunication } from "@flyee/courts/types";

const communication = (overrides: Partial<DjenCommunication>): DjenCommunication => ({
  hash: "h",
  court: "TJGO",
  cnj: "10003012720998090100",
  availableOn: "2026-10-20",
  kind: "Intimação",
  documentType: null,
  text: "",
  link: null,
  unit: "1º Juizado Especial Cível de Goiânia",
  className: "Procedimento do Juizado Especial Cível",
  active: true,
  cancelReason: null,
  ...overrides,
});

const AIRLINES = [
  { iata: "ZZ", name: "Companhia de Teste", names: ["COMPANHIA AEREA DE TESTE SA", "Companhia de Teste"] },
  { iata: "YY", name: "Outra de Teste", names: ["OUTRA LINHAS DE TESTE"] },
  { iata: "XX", name: "Tam de Teste", names: ["TAM"] },
];

describe("the x-ray by the OAB", () => {
  it("counts communications and lawsuits by court, kind and month, and the airline each lawsuit's texts name alone", () => {
    const xray = xrayOf(
      [
        communication({ hash: "a", text: "Réu: COMPANHIA AÉREA DE TESTE SA. Cite-se." }),
        communication({ hash: "b", availableOn: "2026-11-02", text: "Designada audiência." }),
        communication({
          hash: "c",
          cnj: "10003021220998090100",
          court: "TJSP",
          unit: "1ª Vara Cível",
          className: "Procedimento Comum Cível",
          availableOn: "2026-11-03",
          text: "Ré: OUTRA LINHAS DE TESTE. ESTAMOS aguardando.",
        }),
        communication({
          hash: "d",
          cnj: "10003039420998090100",
          text: "COMPANHIA AEREA DE TESTE SA e OUTRA LINHAS DE TESTE, rés.",
          className: null,
          unit: null,
        }),
      ],
      AIRLINES,
    );
    expect(xray.communications).toBe(4);
    expect(xray.lawsuits).toBe(3);
    expect(xray.byCourt).toEqual([
      { court: "TJGO", lawsuits: 2 },
      { court: "TJSP", lawsuits: 1 },
    ]);
    expect(xray.byKind).toEqual({ juizado: 1, comum: 1, other: 1 });
    expect(xray.byMonth).toEqual([
      { month: "2026-10", communications: 2 },
      { month: "2026-11", communications: 2 },
    ]);
    // "TAM" is no word in "ESTAMOS", and a lawsuit naming two airlines counts for none.
    expect(xray.byAirline).toEqual([
      { iata: "ZZ", name: "Companhia de Teste", lawsuits: 1 },
      { iata: "YY", name: "Outra de Teste", lawsuits: 1 },
    ]);
  });
});

describe("the signs of each lawsuit's area", () => {
  it("reads each lawsuit once, with its court, class and kind, one airline named alone and the INSS", () => {
    const signs = lawsuitSignsOf(
      [
        {
          key: "1",
          court: "TJGO",
          className: "Procedimento do Juizado Especial Cível",
          unit: "1º Juizado Especial Cível",
          text: "contra COMPANHIA AEREA DE TESTE SA",
        },
        { key: "1", court: "TJGO", className: null, unit: null, text: "intimem-se" },
        {
          key: "2",
          court: "TRF1",
          className: "Procedimento Comum Cível",
          unit: null,
          text: "réu: Instituto Nacional do Seguro Social",
        },
        { key: "3", court: "TJGO", className: null, unit: null, text: "COMPANHIA DE TESTE e OUTRA LINHAS DE TESTE" },
      ],
      AIRLINES,
    );
    expect(signs).toEqual([
      {
        court: "TJGO",
        className: "Procedimento do Juizado Especial Cível",
        kind: "juizado",
        airline: true,
        inss: false,
      },
      { court: "TRF1", className: "Procedimento Comum Cível", kind: "comum", airline: false, inss: true },
      { court: "TJGO", className: null, kind: null, airline: false, inss: false },
    ]);
  });
});
