import { describe, expect, it } from "vitest";

import type { CaseListRow } from "@/lib/cases/list";
import { caseHits, isSearchShortcut, isSetupPath, SEARCH_HITS, searchable } from "@/lib/search/global-search";

const row = (seq: number, client = `Cliente ${seq}`): CaseListRow => ({
  id: `case-${seq}`,
  seq,
  client,
  module: "direito-do-passageiro",
  incident: "cancellation",
  airline: "LA",
  flightDate: "2026-10-12",
  status: "intake",
  updatedAt: "2026-11-07T12:00:00Z",
  toReview: 0,
  clientFinished: false,
  chronologyContested: false,
  complaintOverdue: false,
  pieceWaiting: false,
  courtMoved: false,
  civilRefused: false,
  agency: null,
  court: null,
});

const key = (
  value: string,
  more: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }> = {},
) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: { tagName: "BODY" },
  ...more,
});

describe("searchable", () => {
  it("asks only with at least two letters or digits", () => {
    expect(searchable("")).toBe(false);
    expect(searchable("a")).toBe(false);
    expect(searchable(" . - ")).toBe(false);
    expect(searchable("Jo")).toBe(true);
    expect(searchable("12")).toBe(true);
    expect(searchable("ç ã")).toBe(true);
    expect(searchable("529.982.247-25")).toBe(true);
  });
});

describe("caseHits", () => {
  it("keeps the first cases of the page, each with its own number and client", () => {
    const rows = Array.from({ length: 12 }, (_, index) => row(index + 1));
    const hits = caseHits(rows);
    expect(hits).toHaveLength(SEARCH_HITS);
    expect(hits[0]).toEqual({ id: "case-1", label: "#1", client: "Cliente 1", status: "intake" });
  });

  it("keeps a case with no client yet, said by its number", () => {
    expect(caseHits([row(7, "")])[0]).toMatchObject({ label: "#7", client: "" });
  });
});

describe("isSearchShortcut", () => {
  it("opens the search with / outside a field", () => {
    expect(isSearchShortcut(key("/"))).toBe(true);
  });

  it("leaves / to whoever is typing in a field", () => {
    expect(isSearchShortcut(key("/", { target: { tagName: "INPUT" } }))).toBe(false);
    expect(isSearchShortcut(key("/", { target: { tagName: "textarea" } }))).toBe(false);
    expect(isSearchShortcut(key("/", { target: { tagName: "DIV", isContentEditable: true } }))).toBe(false);
  });

  it("opens the search with Ctrl+K or Cmd+K anywhere", () => {
    expect(isSearchShortcut(key("k", { ctrlKey: true, target: { tagName: "INPUT" } }))).toBe(true);
    expect(isSearchShortcut(key("K", { metaKey: true }))).toBe(true);
  });

  it("ignores other keys and Alt", () => {
    expect(isSearchShortcut(key("k"))).toBe(false);
    expect(isSearchShortcut(key("/", { ctrlKey: true }))).toBe(false);
    expect(isSearchShortcut(key("k", { ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe("isSetupPath", () => {
  it("is the firm's setup, a module's and a person's, and nothing else", () => {
    expect(isSetupPath("/configurar")).toBe(true);
    expect(isSetupPath("/configurar/direito-do-passageiro")).toBe(true);
    expect(isSetupPath("/configuracoes")).toBe(false);
    expect(isSetupPath("/casos")).toBe(false);
  });
});
