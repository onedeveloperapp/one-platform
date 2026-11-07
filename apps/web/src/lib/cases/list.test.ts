// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { CASE_STATUSES, CLIENT_STAGES, STATUS_GROUPS } from "@/lib/cases/cases";
import {
  CASE_FILTERS,
  CASE_SORTS,
  caseListOf,
  caseListQuery,
  DEFAULT_PAGE_SIZE,
  lastPage,
  MOST_SEARCH,
  PAGE_SIZES,
} from "@/lib/cases/list";

const ROOT = path.resolve(__dirname, "../../../../..");
// The latest definition of `firm_cases` (0033, 0075, 0078, redefined with the list bar of phase 0 in 0108).
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0108_case_list_bar.sql"), "utf8");

/** The quoted names of a list of the migration, from the text that opens it to the parenthesis that closes it. */
function listed(opening: string, from = 0): string[] {
  const start = MIGRATION.indexOf(opening, from);
  expect(start, opening).toBeGreaterThan(-1);
  const body = MIGRATION.slice(start + opening.length, MIGRATION.indexOf(")", start + opening.length));
  return [...body.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

describe("what the list asks of the database", () => {
  it("is read from whatever a caller hands, since a server action is a public endpoint", () => {
    expect(caseListQuery({ filter: "filed", search: "  maria  ", page: 3, pageSize: 50 })).toEqual({
      filter: "filed",
      search: "maria",
      module: null,
      page: 3,
      pageSize: 50,
      sort: "recent",
      incident: null,
      airline: null,
    });
    const nothing = {
      filter: null,
      search: "",
      module: null,
      page: 0,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: "recent",
      incident: null,
      airline: null,
    };
    for (const input of [null, undefined, "x", 7, [], {}, { filter: "tudo", search: 9, page: -1, pageSize: 7 }]) {
      expect(caseListQuery(input), JSON.stringify(input)).toEqual(nothing);
    }
    expect(caseListQuery({ page: 1.5, pageSize: 5000 })).toEqual(nothing);
    expect(caseListQuery({ search: "a".repeat(500) }).search).toHaveLength(MOST_SEARCH);
    expect(caseListQuery({ page: 10 ** 9 }).page).toBe(100_000);
    // A module's area asks its own cases; what is not a module's key asks every module's.
    expect(caseListQuery({ module: "direito-do-passageiro" }).module).toBe("direito-do-passageiro");
    for (const module of ["../x", "X", 7, "", "a"]) expect(caseListQuery({ module }).module).toBeNull();
    // The order and the list's own filters: what the database takes, and nothing else.
    expect(caseListQuery({ sort: "oldest", incident: "baggage_lost", airline: "g3" })).toMatchObject({
      sort: "oldest",
      incident: "baggage_lost",
      airline: "G3",
    });
    expect(caseListQuery({ sort: "alfabetica", incident: "Atraso", airline: "Gol Linhas" })).toMatchObject({
      sort: "recent",
      incident: null,
      airline: null,
    });
  });

  it("names the filters, the stages of each and the sizes of a page as the database has them", () => {
    // The filters `firm_cases` accepts are the ones the list has.
    expect(listed("wanted not in (").sort()).toEqual([...CASE_FILTERS].sort());
    // And the orders it accepts are the ones the list offers.
    expect(listed("sort_by not in (").sort()).toEqual([...CASE_SORTS].sort());
    // Each group of stages, as the function filters and counts it.
    const group = (name: string) => {
      const filtered = MIGRATION.indexOf(`when wanted = '${name}' then fl.status`);
      expect(filtered, name).toBeGreaterThan(-1);
      const line = MIGRATION.slice(filtered, MIGRATION.indexOf("\n", filtered));
      return [...line.replace(`'${name}'`, "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    };
    for (const [name, stages] of Object.entries(STATUS_GROUPS)) {
      expect(group(name).sort(), name).toEqual([...stages].sort());
      const counted = MIGRATION.indexOf(`'${name}', count(*) filter (where status`);
      const line = MIGRATION.slice(counted, MIGRATION.indexOf("\n", counted));
      expect(
        [...line.replace(`'${name}'`, "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort(),
        `count of ${name}`,
      ).toEqual([...stages].sort());
    }
    // Every stage is in one group, so the groups count every case once.
    expect(Object.values(STATUS_GROUPS).flat().sort()).toEqual([...CASE_STATUSES].sort());
    // "The client finished" counts while the case still waits on the client.
    expect(listed("f.case_id is not null and c.status in (").sort()).toEqual([...CLIENT_STAGES].sort());
    // The largest page the list offers is the most the database serves.
    expect(MIGRATION).toContain(
      `least(greatest(coalesce(target_limit, ${DEFAULT_PAGE_SIZE}), 1), ${Math.max(...PAGE_SIZES)})`,
    );
    expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE);
  });
});

describe("the database's answer, as the list reads it", () => {
  const row = {
    id: "d0300000-0000-4000-8000-000000000001",
    seq: 12,
    client: "Maria Teste",
    module: "direito-do-passageiro",
    incident: "delay",
    airline_iata: "G3",
    flight_date: "2026-07-20",
    status: "filed",
    updated_at: "2026-10-11T12:00:00+00:00",
    to_review: 2,
    client_finished: false,
    chronology_contested: true,
    complaint_overdue: false,
    piece_waiting: true,
    court_moved: true,
  };
  const counts = { all: 9, going: 7, open: 3, preparing: 2, filed: 2, ended: 2, documentos: 1, andamento: 1 };

  it("becomes the rows, the total and the count of every filter", () => {
    const page = caseListOf({ rows: [row], total: 41, counts });
    expect(page?.rows).toEqual([
      {
        id: row.id,
        seq: 12,
        client: "Maria Teste",
        module: "direito-do-passageiro",
        incident: "delay",
        airline: "G3",
        flightDate: "2026-07-20",
        status: "filed",
        updatedAt: row.updated_at,
        toReview: 2,
        clientFinished: false,
        chronologyContested: true,
        complaintOverdue: false,
        pieceWaiting: true,
        courtMoved: true,
        civilRefused: false,
        agency: null,
        // What the case's lawsuits show in court is read beside the list (`withCourtMarks`), never from its answer.
        court: null,
      },
    ]);
    expect(page?.total).toBe(41);
    // A filter the answer did not count is zero, never undefined.
    expect(page?.counts).toEqual({
      all: 9,
      going: 7,
      open: 3,
      preparing: 2,
      filed: 2,
      ended: 2,
      documentos: 1,
      "cliente-terminou": 0,
      cronologia: 0,
      reclamacao: 0,
      pecas: 0,
      andamento: 1,
      "vara-civel": 0,
      agencia: 0,
      "novos-mes": 0,
      "ajuizados-mes": 0,
      "encerrados-mes": 0,
    });
  });

  it("keeps a case of a module with no kinds of problem, said by its module", () => {
    const page = caseListOf({
      rows: [{ ...row, id: "y", module: "modulo-de-teste", incident: null, airline_iata: null }],
      total: 1,
      counts,
    });
    expect(page?.rows[0]).toMatchObject({ id: "y", module: "modulo-de-teste", incident: null });
    expect(
      caseListOf({ rows: [{ ...row, incident: "something else" }], total: 1, counts })?.rows[0]?.incident,
    ).toBeNull();
  });

  it("names the agency a case came from", () => {
    const page = caseListOf({ rows: [{ ...row, agency: "Viagens Teste" }], total: 1, counts });
    expect(page?.rows[0]?.agency).toBe("Viagens Teste");
  });

  it("leaves out a case it cannot read, and is nothing when the answer is no list", () => {
    const page = caseListOf({
      rows: [row, { ...row, id: "x", status: "a stage of tomorrow" }, { ...row, id: 7 }, null, "a row"],
      total: 6,
      counts,
    });
    expect(page?.rows.map((item) => item.id)).toEqual([row.id]);
    expect(
      caseListOf({ rows: [{ ...row, client: null, airline_iata: null, flight_date: null }], total: 1, counts })
        ?.rows[0],
    ).toMatchObject({ client: "", airline: null, flightDate: null });
    for (const answer of [null, undefined, "x", [], {}, { rows: [] }, { counts }, { rows: "x", counts }]) {
      expect(caseListOf(answer), JSON.stringify(answer)).toBeNull();
    }
  });

  it("knows the last page of a list", () => {
    expect(lastPage(0, 25)).toBe(0);
    expect(lastPage(25, 25)).toBe(0);
    expect(lastPage(26, 25)).toBe(1);
    expect(lastPage(101, 50)).toBe(2);
    expect(lastPage(10, 0)).toBe(9);
  });
});
