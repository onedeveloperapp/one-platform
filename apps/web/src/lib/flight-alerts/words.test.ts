import { describe, expect, it } from "vitest";

import {
  alertParams,
  assistanceWords,
  flightLabel,
  flightWords,
  lateWords,
  listOf,
  whatWords,
} from "@/lib/flight-alerts/words";

// Every flight and person here is invented; the cities are public reference data.

const GRU_REC = {
  position: 1,
  flightNumber: "LA3456",
  origin: "GRU",
  originCity: "São Paulo",
  destination: "REC",
  destinationCity: "Recife",
  departure: "2099-10-22T08:10:00",
};

describe("ONE's first word when a flight has a problem", () => {
  it("names a flight as people write it, and a list as Portuguese says it", () => {
    expect(flightLabel("LA3456")).toBe("LA 3456");
    expect(flightLabel("G31450")).toBe("G3 1450");
    expect(flightLabel("AD4120A")).toBe("AD 4120A");
    expect(listOf(["a"])).toBe("a");
    expect(listOf(["a", "b"])).toBe("a e b");
    expect(listOf(["a", "b", "c"])).toBe("a, b e c");
  });

  it("says the trip with its cities, its connection and its day", () => {
    expect(flightWords([GRU_REC])).toBe("LA 3456 de São Paulo (GRU) para Recife (REC), de 22/10/2099");
    expect(
      flightWords([
        {
          ...GRU_REC,
          position: 2,
          flightNumber: "AD2735",
          origin: "VCP",
          originCity: "Campinas",
          destination: "POA",
          destinationCity: "Porto Alegre",
          departure: "2099-10-22T09:30:00",
        },
        {
          ...GRU_REC,
          flightNumber: "AD4120",
          origin: "CNF",
          originCity: "Belo Horizonte",
          destination: "VCP",
          destinationCity: "Campinas",
          departure: "2099-10-22T07:00:00",
        },
      ]),
    ).toBe(
      "AD 4120 e AD 2735 de Belo Horizonte (CNF) para Porto Alegre (POA), com conexão em Campinas (VCP), de 22/10/2099",
    );
    // An airport with no city on record is named by its code.
    expect(flightWords([{ ...GRU_REC, destinationCity: null }])).toBe(
      "LA 3456 de São Paulo (GRU) para REC, de 22/10/2099",
    );
  });

  it("says what happened, and how late in hours and minutes", () => {
    expect(whatWords("cancelled", null)).toBe("foi cancelado");
    expect(whatWords("delayed", 360)).toBe("está previsto para chegar ao destino com 6 horas de atraso");
    expect(lateWords(60)).toBe("1 hora");
    expect(lateWords(270)).toBe("4 horas e 30 minutos");
    expect(lateWords(45)).toBe("45 minutos");
  });

  it("says what the airline owes by ANAC's rules", () => {
    expect(assistanceWords({ kind: "cancelled", leg: 1, delayMinutes: null })).toBe(
      "oferecer outro voo, o reembolso ou outro meio de transporte, e dar meios de comunicação, alimentação e hospedagem, se for preciso passar a noite, com o transporte até ela",
    );
    expect(assistanceWords({ kind: "delayed", leg: 1, delayMinutes: 150 })).toBe(
      "dar meios de comunicação e alimentação",
    );
    expect(assistanceWords({ kind: "changed", leg: 1, delayMinutes: null })).toBe(
      "oferecer outro voo, o reembolso ou outro meio de transporte",
    );
  });

  it("fills the five values of the template, each a clean line with no dash and no exclamation", () => {
    const params = alertParams({
      kind: "cancelled",
      delayMinutes: null,
      passengerName: "  Mariana   Teste ",
      firm: "Souza Advogados",
      legs: [GRU_REC],
    });
    expect(params).toHaveLength(5);
    expect(params[0]).toBe("Mariana");
    expect(params[2]).toBe("LA 3456 de São Paulo (GRU) para Recife (REC), de 22/10/2099");
    for (const value of params) {
      expect(value).toBe(value.trim());
      expect(value).not.toMatch(/[–—!\n]/);
      expect(value.length).toBeLessThanOrEqual(500);
    }
  });
});
