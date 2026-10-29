import { describe, expect, it } from "vitest";

import type { ParsedTable } from "@/lib/import/table";
import {
  guessPaxMapping,
  hourOf,
  IMPORT_FIELD_KEY,
  IMPORT_PROBLEM_KEY,
  missingPaxRequired,
  paxHeaderScore,
  planPaxImport,
} from "@/modules/direito-do-passageiro/agency/import";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

const table = (headers: string[], rows: string[][]): ParsedTable => ({
  headers,
  rows,
  lines: rows.map((_, index) => index + 2),
  format: "csv",
  sheet: null,
});

describe("the columns of an agency's export", () => {
  it("finds each fact by the names agencies give it, an hour before a day", () => {
    const mapping = guessPaxMapping([
      "Passageiro",
      "CPF",
      "Data de nascimento",
      "Celular",
      "E-mail",
      "Localizador",
      "Voo",
      "Origem",
      "Destino",
      "Data do voo",
      "Hora de partida",
      "Hora de chegada",
    ]);
    expect(mapping).toEqual({
      name: 0,
      cpf: 1,
      birth_date: 2,
      phone: 3,
      email: 4,
      locator: 5,
      flight: 6,
      origin: 7,
      destination: 8,
      departure_date: 9,
      departure_time: 10,
      arrival_time: 11,
    });
    expect(missingPaxRequired(mapping)).toEqual([]);
    expect(missingPaxRequired({ cpf: 0 })).toEqual(["name"]);
  });

  it("never reads a short word inside a longer header", () => {
    expect(guessPaxMapping(["Data de emissão", "Para uso interno"])).toEqual({});
    expect(paxHeaderScore(["Nome", "CPF", "Voo"])).toBe(3);
    expect(paxHeaderScore(["Relatório de reservas", "", ""])).toBe(0);
  });
});

describe("an hour", () => {
  it("reads the ways an export writes one", () => {
    expect(hourOf("14:30")).toBe("14:30");
    expect(hourOf("9h05")).toBe("09:05");
    expect(hourOf("21h")).toBe("21:00");
    expect(hourOf("14:30:00")).toBe("14:30");
    expect(hourOf("1899-12-30 06:15")).toBe("06:15");
    expect(hourOf("03/11/2026")).toBeNull();
    expect(hourOf("25:00")).toBeNull();
  });
});

describe("the lines that go", () => {
  const headers = [
    "Nome",
    "CPF",
    "Nascimento",
    "WhatsApp",
    "Localizador",
    "Voo",
    "Origem",
    "Destino",
    "Partida",
    "Chegada",
  ];

  it("writes a passenger and their leg as the database takes them", () => {
    const plan = planPaxImport(
      table(headers, [
        [
          "Mariana  Teste",
          "111.444.777-35",
          "02/03/1988",
          "(62) 99999-0001",
          "abc 123",
          "la 3456",
          "gru",
          "gig",
          "03/11/2026 14:30",
          "03/11/2026 15:35",
        ],
      ]),
      guessPaxMapping(headers),
    );
    expect(plan.problems).toEqual([]);
    expect(plan.rows).toEqual([
      {
        line: 2,
        nome: "Mariana Teste",
        cpf: "11144477735",
        nascimento: "1988-03-02",
        whatsapp: "(62) 99999-0001",
        localizador: "ABC123",
        voo: "LA3456",
        origem: "GRU",
        destino: "GIG",
        partida: "2026-11-03T14:30",
        chegada: "2026-11-03T15:35",
      },
    ]);
    expect(plan.counts).toEqual({ withCpf: 1, withPhone: 1, withLocator: 1, withFlight: 1 });
  });

  it("lands a flight on the next day when its hour of arrival comes before its departure", () => {
    const columns = ["Nome", "Localizador", "Voo", "Origem", "Destino", "Data", "Hora de partida", "Hora de chegada"];
    const plan = planPaxImport(
      table(columns, [["Lúcia Teste", "XYZ987", "TP 108", "GRU", "LIS", "2026-11-20", "22:40", "11:55"]]),
      guessPaxMapping(columns),
    );
    expect(plan.rows[0]).toMatchObject({ partida: "2026-11-20T22:40", chegada: "2026-11-21T11:55" });
  });

  it("says what it could not read, and sends nothing of that line", () => {
    const plan = planPaxImport(
      table(headers, [
        ["", "", "", "", "", "", "", "", "", ""],
        ["", "529.982.247-25", "", "", "", "", "", "", "", ""],
        ["Rafael Teste", "", "31/02/1990", "", "", "", "", "", "", ""],
        ["Pedro Teste", "", "", "", "QWE456", "G3 1234", "CGH", "SDU", "amanhã", "10:00"],
        ["Ana Teste", "", "", "", "", "G3 1234", "CGH", "SDU", "03/11/2026 08:00", "03/11/2026 09:05"],
        ["Rui Teste", "", "", "", "", "", "", "", "", ""],
      ]),
      guessPaxMapping(headers),
    );
    expect(plan.problems).toEqual([
      { line: 3, code: "no_name" },
      { line: 4, code: "birth_date_unreadable" },
      { line: 5, code: "departure_unreadable" },
      { line: 6, code: "leg_incomplete" },
    ]);
    expect(plan.rows).toEqual([{ line: 7, nome: "Rui Teste" }]);
  });

  it("has words for every fact and every problem", () => {
    for (const key of [...Object.values(IMPORT_FIELD_KEY), ...Object.values(IMPORT_PROBLEM_KEY)]) {
      expect(product[key], key).toBeTruthy();
    }
  });
});
