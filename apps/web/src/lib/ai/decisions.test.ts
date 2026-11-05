import { decisionHref, decisionItems, type WaitingDecision } from "./decisions";
import { describe, expect, it } from "vitest";

import { withDecisions } from "@/lib/firm/pending";

// Every case and person here is invented.

const decision = (overrides: Partial<WaitingDecision>): WaitingDecision => ({
  approvalId: "ap-1",
  kind: "document",
  mine: true,
  caseId: "case-1",
  caseSeq: 12,
  client: "Ana Teste",
  conversationId: null,
  since: "2026-11-05T12:00:00Z",
  ...overrides,
});

describe("where each decision is taken", () => {
  it("leads to the card of its case, or to its conversation, never to the list", () => {
    expect(decisionHref(decision({ kind: "piece" }))).toBe("/casos/case-1#case-drafts");
    expect(decisionHref(decision({ kind: "document" }))).toBe("/casos/case-1#case-documents");
    expect(decisionHref(decision({ kind: "chronology" }))).toBe("/casos/case-1#case-statements");
    expect(decisionHref(decision({ kind: "conversation", caseId: null, conversationId: "cv-1" }))).toBe(
      "/atendimento?c=cv-1",
    );
    // One of no case (the platform's own check) is decided in the list.
    expect(decisionHref(decision({ kind: "other", caseId: null }))).toBe("/aprovacoes");
  });

  it("names each one by its case, and the rest in one line", () => {
    const items = decisionItems({ mine: [decision({ kind: "piece" })], mineTotal: 3, others: 0 });
    expect(items.map((item) => [item.id, item.href])).toEqual([
      ["decision:ap-1", "/casos/case-1#case-drafts"],
      ["decisions:more", "/aprovacoes"],
    ]);
    expect(items[0].label).toEqual({ key: "pending-case", values: { seq: 12, client: "Ana Teste" } });
    expect(items[1].count).toBe(2);
  });
});

describe("the home's needs with the decisions read one by one", () => {
  const needs = [
    { key: "approvals" as const, count: 4, href: "/aprovacoes" },
    { key: "queue" as const, count: 5, href: "/aprovacoes" },
    { key: "drafts" as const, count: 1, href: "/casos?ver=pecas" },
  ];
  it("takes the person's own out of the counts, and counts the others as the list shows them", () => {
    expect(withDecisions(needs, { mine: [], mineTotal: 0, others: 2 })).toEqual([
      { key: "queue", count: 2, href: "/aprovacoes" },
      { key: "drafts", count: 1, href: "/casos?ver=pecas" },
    ]);
    // Unread, the needs stay as the home counted them.
    expect(withDecisions(needs, null)).toEqual(needs);
  });
});
