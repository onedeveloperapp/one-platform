import { describe, expect, it } from "vitest";

import {
  cpfText,
  PORTFOLIO_SHEETS,
  portfolioAbout,
  portfolioBegunOf,
  portfolioColumns,
  portfolioLine,
  portfolioRowsOf,
  portfolioWorkbook,
  type Say,
} from "@/lib/controladoria/portfolio";

const say: Say = (key, values) => (values ? `${key}:${JSON.stringify(values)}` : key);
const line = (sheet: (typeof PORTFOLIO_SHEETS)[number], row: Record<string, unknown>) => {
  const titles = portfolioColumns(sheet, say).map((column) => column.title);
  const cells = portfolioLine(sheet, row, say);
  return Object.fromEntries(titles.map((title, at) => [title, cells[at]]));
};

describe("what the database answers of beginning a portfolio", () => {
  const counts = {
    clientes: 3,
    casos: 2,
    acoes: 2,
    prazos: 2,
    audiencias: 2,
    documentos: 1,
    lancamentos: 4,
    contas: 1,
  };

  it("takes a whole answer", () => {
    expect(portfolioBegunOf({ ok: true, page: 2000, counts, left: 2 })).toEqual({
      ok: true,
      pageSize: 2000,
      counts,
      left: 2,
    });
  });

  it("says each refusal with what it carries, and anything else is a failure, never a portfolio", () => {
    expect(portfolioBegunOf({ ok: false, code: "second_factor" })).toEqual({ ok: false, code: "second_factor" });
    expect(portfolioBegunOf({ ok: false, code: "too_many", limit: 300000, sheet: "documentos" })).toEqual({
      ok: false,
      code: "too_many",
      limit: 300000,
      sheet: "documentos",
    });
    expect(portfolioBegunOf({ ok: false, code: "daily_limit", limit: 3 })).toMatchObject({ limit: 3 });
    expect(portfolioBegunOf({ ok: false, code: "nao_sei" })).toEqual({ ok: false, code: "failed" });
    expect(portfolioBegunOf(null)).toEqual({ ok: false, code: "failed" });
    // A count missing is no whole portfolio: a sheet would be taken as having nothing.
    expect(portfolioBegunOf({ ok: true, page: 2000, counts: { clientes: 3 } })).toEqual({ ok: false, code: "failed" });
    expect(portfolioBegunOf({ ok: true, page: 0, counts })).toEqual({ ok: false, code: "failed" });
  });

  it("reads a page, and a page that is not one is a read that failed, never a sheet with nothing", () => {
    expect(portfolioRowsOf({ rows: [{ name: "Maria Teste" }] })).toEqual([{ name: "Maria Teste" }]);
    expect(portfolioRowsOf({ rows: [] })).toEqual([]);
    expect(portfolioRowsOf({})).toBeNull();
    expect(portfolioRowsOf(null)).toBeNull();
  });
});

describe("each row as a line of its sheet", () => {
  it("every line has the cells of its columns, even of an empty row", () => {
    for (const sheet of PORTFOLIO_SHEETS) {
      expect(portfolioLine(sheet, {}, say)).toHaveLength(portfolioColumns(sheet, say).length);
    }
  });

  it("writes a client with their CPF as people write it, and their cases", () => {
    const client = line("clientes", {
      name: "Maria Teste",
      cpf: "52998224725",
      birth_date: "1985-04-02",
      marital_status: "casado",
      email: "maria@teste.invalid",
      phone: "5500988880001",
      postal_code: "74000000",
      street: "Rua das Flores",
      cases: [12, 40],
      created_at: "2026-11-09 10:30",
    });
    expect(client).toMatchObject({
      "case-field-full-name": "Maria Teste",
      "case-field-cpf": "529.982.247-25",
      "case-field-birth-date": "1985-04-02",
      "case-field-email": "maria@teste.invalid",
      "case-field-phone": "5500988880001",
      // A CEP with zeros in front is a text: a number would lose them.
      "case-field-postal-code": "74000000",
      "case-field-street": "Rua das Flores",
      "portfolio-column-cases": "#12, #40",
      "portfolio-column-created": "2026-11-09 10:30",
    });
    expect(client["case-field-marital-status"]).toBeTruthy();
    expect(line("clientes", { name: "Lia Teste", cases: [] })["portfolio-column-cases"]).toBeNull();
  });

  it("writes a case by the words the screens use", () => {
    expect(
      line("casos", {
        seq: 41,
        client: "Maria Teste",
        module: "direito-do-passageiro",
        module_name: "Direito do Passageiro",
        status: "filed",
        airline: "GOL",
        flight_date: "2026-09-20",
        is_test: true,
      }),
    ).toMatchObject({
      "cases-column-case": 41,
      "cases-column-module": "Direito do Passageiro",
      "cases-export-status": "case-status-filed",
      "cases-export-airline": "GOL",
      "cases-export-flight-date": "2026-09-20",
      "cases-test-mark": "cases-export-yes",
    });
    expect(line("casos", { seq: 1, is_test: false })["cases-test-mark"]).toBeNull();
  });

  it("writes a lawsuit with its number as the court writes it and the claim in reais", () => {
    expect(
      line("acoes", {
        seq: 41,
        cnj: "00051016820998090051",
        kind: "juizado",
        status: "filed",
        system: "projudi",
        filed_at: "2026-10-01",
        claimants: "Maria Teste",
        claim_cents: 1050050,
        lawyers: "Ana Lima (OAB/GO 19181)",
      }),
    ).toMatchObject({
      "portfolio-column-cnj": "0005101-68.2099.8.09.0051",
      "case-proceeding-kind": "case-proceeding-kind-juizado",
      "portfolio-column-lawsuit-status": "portfolio-lawsuit-filed",
      "case-proceeding-system": "case-system-projudi",
      "portfolio-column-claim": 10500.5,
      "portfolio-column-lawyers": "Ana Lima (OAB/GO 19181)",
    });
    // No value asked is no value, never zero: the judge defines it.
    expect(line("acoes", { seq: 41, claim_cents: null })["portfolio-column-claim"]).toBeNull();
  });

  it("writes a deadline, also of a lawsuit the firm has no case of", () => {
    expect(
      line("prazos", {
        seq: null,
        cnj: "00051025320998090051",
        title: "Recurso inominado",
        days: 10,
        counting: "business",
        due_on: "2026-10-26",
        status: "confirmed",
        confirmed_auto: true,
      }),
    ).toMatchObject({
      "cases-column-case": null,
      "portfolio-column-deadline": "Recurso inominado",
      "portfolio-column-days": 10,
      "portfolio-column-counting": "deadline-counting-business",
      "portfolio-column-due": "2026-10-26",
      "portfolio-column-deadline-status": "deadline-status-confirmed",
      "portfolio-column-confirmed-one": "cases-export-yes",
    });
  });

  it("writes a hearing on the clock of its zone, with how, where, who goes and what came of it", () => {
    expect(
      line("audiencias", {
        seq: 41,
        cnj: "00051016820998090051",
        court: "TJGO",
        kind: "conciliacao",
        starts_at: "2026-11-20 14:00",
        time_zone: "America/Sao_Paulo",
        mode: "videoconferencia",
        link: "https://videoconferencia.teste.invalid/sala-1",
        attendee: "Caio Lima",
        status: "scheduled",
        created_auto: true,
      }),
    ).toMatchObject({
      "cases-column-case": 41,
      "portfolio-column-cnj": "0005101-68.2099.8.09.0051",
      "hearing-field-kind": "hearing-kind-conciliacao",
      "portfolio-column-hearing-at": "2026-11-20 14:00",
      "hearing-field-zone": "hearing-zone-brasilia",
      "hearing-field-mode": "hearing-mode-videoconferencia",
      "portfolio-column-link": "https://videoconferencia.teste.invalid/sala-1",
      "hearing-field-attendee": "Caio Lima",
      "portfolio-column-hearing-status": "hearing-status-scheduled",
      "hearing-field-outcome": null,
      "portfolio-column-registered-one": "cases-export-yes",
    });
    expect(
      line("audiencias", { status: "held", outcome: "sem_acordo", outcome_note: "A ré não propôs acordo." }),
    ).toMatchObject({
      "hearing-field-outcome": "hearing-outcome-sem-acordo",
      "portfolio-column-outcome-note": "A ré não propôs acordo.",
      "portfolio-column-registered-one": null,
    });
    // A zone the app does not name yet is written as it came, never left out.
    expect(line("audiencias", { time_zone: "America/Recife" })["hearing-field-zone"]).toBe("America/Recife");
  });

  it("writes a document as an index, with no way to the file", () => {
    const document = line("documentos", {
      seq: 41,
      person: "Maria Teste",
      kind: "identity",
      status: "accepted",
      source: "client",
      name: "identidade.pdf",
      mime: "application/pdf",
      bytes: 4000,
      pages: 1,
      sha256: "a".repeat(64),
    });
    expect(document).toMatchObject({
      "portfolio-column-person": "Maria Teste",
      "portfolio-column-source": "case-document-source-client",
      "portfolio-column-file": "identidade.pdf",
      "portfolio-column-bytes": 4000,
      "portfolio-column-sha": "a".repeat(64),
    });
    expect(Object.values(document).join(" ")).not.toContain("org/");
  });

  it("says a word it does not know as it came, never as nothing", () => {
    expect(line("acoes", { status: "novo" })["portfolio-column-lawsuit-status"]).toBe("novo");
    expect(line("casos", { status: "novo" })["cases-export-status"]).toBe("novo");
  });

  it("writes a CPF as people write it, and leaves what is no CPF as it is", () => {
    expect(cpfText("12345678909")).toBe("123.456.789-09");
    expect(cpfText("123")).toBe("123");
    expect(cpfText(null)).toBeNull();
  });
});

describe("the file", () => {
  const counts = {
    clientes: 3,
    casos: 2,
    acoes: 2,
    prazos: 2,
    audiencias: 2,
    documentos: 1,
    lancamentos: 4,
    contas: 1,
  };
  const about = (testsLeftOut: boolean) =>
    portfolioAbout({
      firm: "Lima Advocacia",
      made: { day: "09/11/2026", time: "12:30" },
      counts,
      testsLeftOut,
      say,
      countText: (value) => String(value),
    });

  it("opens on what it is: whose, when, how many of each, and that it holds personal data", () => {
    const sheet = about(false);
    expect(sheet.plain).toBe(true);
    expect(sheet.columns[1].title).toBe("Lima Advocacia");
    const said = Object.fromEntries(sheet.rows.map((row) => [row[0], row[1]]));
    expect(said["portfolio-about-made"]).toContain("12:30");
    expect(said["portfolio-sheet-clientes"]).toBe("3");
    expect(said["portfolio-sheet-audiencias"]).toBe("2");
    expect(said["portfolio-sheet-documentos"]).toBe("1");
    expect(said["portfolio-about-documents"]).toBe("portfolio-about-documents-body");
    expect(said["portfolio-about-care"]).toBe("portfolio-about-care-body");
    expect(said["portfolio-about-tests"]).toBeUndefined();
  });

  it("says so when the test cases were left out", () => {
    const said = Object.fromEntries(about(true).rows.map((row) => [row[0], row[1]]));
    expect(said["portfolio-about-tests"]).toBe("portfolio-about-tests-out");
  });

  it("has what it is first, then each sheet in order with its lines", () => {
    const sheets = portfolioWorkbook({
      about: about(false),
      lines: {
        clientes: [["Maria Teste"]],
        casos: [],
        acoes: [],
        prazos: [],
        audiencias: [],
        documentos: [],
        lancamentos: [],
        contas: [],
      },
      say,
    });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual([
      "portfolio-sheet-about",
      "portfolio-sheet-clientes",
      "portfolio-sheet-casos",
      "portfolio-sheet-acoes",
      "portfolio-sheet-prazos",
      "portfolio-sheet-audiencias",
      "portfolio-sheet-documentos",
      "portfolio-sheet-lancamentos",
      "portfolio-sheet-contas",
    ]);
    expect(sheets[1].rows).toEqual([["Maria Teste"]]);
  });
});

describe("the books in the portfolio", () => {
  it("writes an entry and a bill as their sheets say them", () => {
    expect(
      portfolioLine(
        "lancamentos",
        {
          occurred_on: "2026-11-05",
          competence_on: "2026-11-05",
          account: "Itaú PJ",
          kind: "expense",
          category: "Aluguel e condomínio",
          center: null,
          cents: -300000,
          counterparty: "Imobiliária Teste",
          description: null,
          seq: null,
          by_one: false,
          cancelled_at: null,
          cancelled_reason: null,
        },
        say,
      ),
    ).toEqual([
      "2026-11-05",
      "2026-11-05",
      "Itaú PJ",
      "finance-kind-expense",
      "Aluguel e condomínio",
      null,
      -3000,
      "Imobiliária Teste",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(
      portfolioLine(
        "contas",
        { direction: "receive", status: "open", cents: 150000, paid_cents: 0, due_on: "2026-11-17", by_one: true },
        say,
      ).slice(0, 2),
    ).toEqual(["portfolio-bill-receive", "portfolio-bill-open"]);
  });
});
