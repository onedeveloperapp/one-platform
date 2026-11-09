import { describe, expect, it } from "vitest";

import {
  brasiliaMoment,
  canExportCases,
  exportBegunOf,
  exportColumns,
  exportLine,
  type ExportWords,
} from "@/lib/cases/export";
import type { CaseListRow } from "@/lib/cases/list";

const words: ExportWords = {
  titles: {
    case: "Caso",
    client: "Cliente",
    module: "Módulo",
    kind: "Problema",
    agency: "Agência",
    airline: "Companhia",
    flightDate: "Data do voo",
    status: "Situação",
    step: "Etapa",
    lawsuits: "Processos",
    movedAt: "Último movimento",
    updatedAt: "Atualizado em",
    holder: "Com quem está",
    why: "Por quê",
    stepDays: "Na etapa há",
    stagnant: "Estagnado",
    test: "Teste",
  },
  moduleName: (key) => `módulo ${key}`,
  kindName: (key) => `tipo ${key}`,
  airlineName: (iata) => `companhia ${iata}`,
  statusName: (status) => `situação ${status}`,
  stepName: (step) => `etapa ${step}`,
  holderName: (holder) => `com ${holder ?? "ninguém"}`,
  reasonName: (holder, why) => (why ? `${holder} por ${why}` : null),
  yes: "Sim",
};

const row: CaseListRow = {
  id: "c1",
  seq: 41,
  client: "Paula Teste",
  module: "direito-do-passageiro",
  incident: "delay",
  airline: "LA",
  flightDate: "2026-10-07",
  status: "filed",
  updatedAt: "2026-11-08T12:30:00Z",
  toReview: 0,
  clientFinished: false,
  chronologyContested: false,
  complaintOverdue: false,
  pieceWaiting: false,
  courtMoved: false,
  civilRefused: false,
  agency: "Agência Sol Teste",
  isTest: false,
  movedAt: "2026-11-08T03:10:00Z",
  cnjs: ["00051016820998090051", "00051025320998090051"],
  court: { held: true, decided: false, paid: false },
  holder: "court",
  why: null,
  step: "judgment",
  stepSince: "2026-10-01T12:00:00Z",
  stepDays: 38,
  stagnant: false,
};

describe("who is offered the spreadsheet", () => {
  it("is a partner, the controladoria or who manages the firm", () => {
    expect(canExportCases("member", "socio")).toBe(true);
    expect(canExportCases("member", "controladoria")).toBe(true);
    expect(canExportCases("admin", "atendimento")).toBe(true);
    expect(canExportCases("owner", "advogado")).toBe(true);
    expect(canExportCases("member", "advogado")).toBe(false);
    expect(canExportCases("member", "atendimento")).toBe(false);
  });
});

describe("what the database answered of beginning one", () => {
  it("is read whole, and anything else is a failure", () => {
    expect(exportBegunOf({ ok: true, page: 2000, left: 19 })).toEqual({ ok: true, pageSize: 2000, left: 19 });
    expect(exportBegunOf({ ok: false, code: "daily_limit", limit: 20 })).toEqual({
      ok: false,
      code: "daily_limit",
      limit: 20,
    });
    expect(exportBegunOf({ ok: false, code: "outra" })).toEqual({ ok: false, code: "failed" });
    expect(exportBegunOf({ ok: true })).toEqual({ ok: false, code: "failed" });
    expect(exportBegunOf(null)).toEqual({ ok: false, code: "failed" });
  });
});

describe("a case as a line of the sheet", () => {
  it("reads a moment on the clock of Brasília", () => {
    expect(brasiliaMoment("2026-11-08T03:10:00Z")).toBe("2026-11-08 00:10");
    expect(brasiliaMoment(null)).toBeNull();
    expect(brasiliaMoment("ontem")).toBeNull();
  });

  it("says the same things the list says, in the order of the columns", () => {
    expect(exportColumns(words, true).map((column) => column.title)).toEqual([
      "Caso",
      "Cliente",
      "Módulo",
      "Problema",
      "Agência",
      "Companhia",
      "Data do voo",
      "Situação",
      "Etapa",
      "Na etapa há",
      "Estagnado",
      "Com quem está",
      "Por quê",
      "Processos",
      "Último movimento",
      "Atualizado em",
      "Teste",
    ]);
    expect(exportLine(row, words, true)).toEqual([
      41,
      "Paula Teste",
      "módulo direito-do-passageiro",
      "tipo delay",
      "Agência Sol Teste",
      "companhia LA",
      "2026-10-07",
      "situação filed",
      "etapa judgment",
      38,
      null,
      "com court",
      null,
      "0005101-68.2099.8.09.0051, 0005102-53.2099.8.09.0051",
      "2026-11-08 00:10",
      "2026-11-08 09:30",
      null,
    ]);
  });

  it("says a test case is one in its own column", () => {
    const line = exportLine({ ...row, isTest: true }, words, true);
    expect(line.at(-1)).toBe("Sim");
  });

  it("leaves the module out when the firm has only one, in the titles and in the line alike", () => {
    const columns = exportColumns(words, false);
    const line = exportLine(row, words, false);
    expect(columns.map((column) => column.title)).not.toContain("Módulo");
    expect(line).toHaveLength(columns.length);
    expect(line[2]).toBe("tipo delay");
  });

  it("leaves empty what the case does not have", () => {
    const line = exportLine(
      {
        ...row,
        incident: null,
        airline: null,
        agency: null,
        cnjs: [],
        movedAt: null,
        court: null,
        status: "drafting",
        holder: "firm",
        why: "piece_review",
        stepDays: 20,
        stagnant: true,
      },
      words,
      false,
    );
    expect(line[2]).toBeNull();
    expect(line[3]).toBeNull();
    expect(line[4]).toBeNull();
    expect(line.slice(7, 12)).toEqual(["etapa drafting", 20, "Sim", "com firm", "firm por piece_review"]);
    expect(line[12]).toBeNull();
  });
});
