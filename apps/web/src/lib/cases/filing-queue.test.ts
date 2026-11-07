import { describe, expect, it } from "vitest";

import type { QueuedFiling } from "@/lib/cases/filing-facts";
import {
  inQueueView,
  isQueueSort,
  isQueueView,
  QUEUE_VIEWS,
  queueCounts,
  queueFacets,
  queueGroups,
  queueMatches,
  queueRows,
} from "@/lib/cases/filing-queue";

const row = (patch: Partial<QueuedFiling> & { id: string }): QueuedFiling => ({
  caseId: `case-${patch.id}`,
  caseSeq: 12,
  client: "Mariana Teste de Oliveira",
  court: "TJGO",
  system: "projudi",
  kind: "juizado",
  comarca: "Goiânia",
  status: "ready",
  files: 4,
  requestedLabel: "7 nov., 10:00",
  requestedAt: "2026-11-07T13:00:00+00:00",
  blocker: null,
  signature: null,
  ...patch,
});

const rows: QueuedFiling[] = [
  row({ id: "a", requestedAt: "2026-11-05T10:00:00+00:00" }),
  row({ id: "b", status: "requested", caseSeq: 3, client: "Rafael Teste", comarca: "Anápolis" }),
  row({ id: "c", blocker: "system_unapproved", requestedAt: "2026-11-06T10:00:00+00:00" }),
  row({ id: "d", status: "failed", court: "TJSP", system: "eproc", comarca: "São Paulo", client: "Lúcia Teste" }),
  row({ id: "e", court: "TJSP", system: "eproc", comarca: "Campinas", requestedAt: "2026-11-01T10:00:00+00:00" }),
];

const all = { search: "", court: null, system: null };

describe("the views of the filing queue", () => {
  it("counts a blocked package where it is blocked, never as ready to file", () => {
    expect(inQueueView(rows[2], "prontos")).toBe(false);
    expect(inQueueView(rows[2], "impedidos")).toBe(true);
    expect(queueCounts(rows, all)).toEqual({ todos: 5, prontos: 2, montagem: 1, impedidos: 1, falha: 1 });
  });

  it("knows its views and orders, and nothing else", () => {
    expect(QUEUE_VIEWS.every(isQueueView)).toBe(true);
    expect(isQueueView("ready")).toBe(false);
    expect(isQueueSort("newest")).toBe(true);
    expect(isQueueSort("recent")).toBe(false);
  });
});

describe("the search of the filing queue", () => {
  it("finds a client by words in any order and without accents", () => {
    expect(queueMatches(rows[3], "teste lucia")).toBe(true);
    expect(queueMatches(rows[3], "lucia souza")).toBe(false);
  });

  it("finds a case by its number, with or without its mark, and a comarca", () => {
    expect(queueMatches(rows[1], "#3")).toBe(true);
    expect(queueMatches(rows[1], "3")).toBe(true);
    expect(queueMatches(rows[1], "anapolis")).toBe(true);
  });

  it("narrows every count to what it finds", () => {
    expect(queueCounts(rows, { ...all, search: "tjsp" })).toEqual({
      todos: 2,
      prontos: 1,
      montagem: 0,
      impedidos: 0,
      falha: 1,
    });
  });
});

describe("the rows the queue shows", () => {
  it("lists the package asked for the longest first, or the latest", () => {
    const query = { ...all, view: "todos" as const };
    expect(queueRows(rows, { ...query, sort: "oldest" }).map((item) => item.id)).toEqual(["e", "a", "c", "b", "d"]);
    expect(queueRows(rows, { ...query, sort: "newest" }).map((item) => item.id)).toEqual(["b", "d", "c", "a", "e"]);
  });

  it("keeps to the court and system asked", () => {
    const shown = queueRows(rows, { ...all, court: "TJSP", system: "eproc", view: "prontos", sort: "oldest" });
    expect(shown.map((item) => item.id)).toEqual(["e"]);
  });

  it("offers each court and system once", () => {
    expect(queueFacets(rows)).toEqual({ courts: ["TJGO", "TJSP"], systems: ["eproc", "projudi"] });
  });

  it("groups by court and system, the groups with a package ready to file first", () => {
    const groups = queueGroups([rows[3], rows[1], rows[0]]);
    expect(groups.map((group) => group.key)).toEqual(["TJGO|projudi", "TJSP|eproc"]);
    expect(groups[0].rows.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
