import { describe, expect, it } from "vitest";

import { type DocumentForLine, documentLine, orderDocuments } from "@/lib/cases/document-rows";

const base: DocumentForLine = {
  status: "received",
  processing: "done",
  check: null,
  rejectedReason: null,
  createdAt: "2026-11-09T12:00:00Z",
};
const doc = (change: Partial<DocumentForLine>): DocumentForLine => ({ ...base, ...change });

describe("documentLine", () => {
  it("asks the firm to decide, saying what ONE suggests", () => {
    expect(
      documentLine(doc({ check: { waiting: true, answer: { decision: "recusar", reason: "foto escura" } } }), null),
    ).toEqual({ place: "ask", tone: "attention", key: "case-rows-doc-suggests-refuse", reason: "foto escura" });
    expect(documentLine(doc({ check: { waiting: true, answer: { decision: "aceitar" } } }), null).key).toBe(
      "case-rows-doc-suggests-accept",
    );
    expect(documentLine(doc({}), null).key).toBe("case-rows-doc-to-review");
  });

  it("waits while ONE checks it: ONE's work, never the firm's", () => {
    expect(documentLine(doc({ processing: "working" }), null)).toMatchObject({ place: "working", tone: "waiting" });
  });

  it("settles a decided one, and asks again of a bill whose address the firm must look at", () => {
    expect(documentLine(doc({ status: "accepted" }), null)).toMatchObject({
      place: "done",
      key: "case-rows-doc-accepted",
    });
    expect(documentLine(doc({ status: "accepted" }), { standing: "conflict" }).place).toBe("ask");
    expect(documentLine(doc({ status: "accepted" }), { standing: "signing" })).toMatchObject({
      place: "done",
      tone: "waiting",
    });
    expect(documentLine(doc({ status: "rejected", rejectedReason: "not_pdf" }), null).reason).toBe("not_pdf");
  });
});

describe("orderDocuments", () => {
  it("puts what asks first, the oldest first, and the decided newest first", () => {
    const items = [
      { id: "a", document: doc({ createdAt: "2026-11-08T00:00:00Z" }) },
      { id: "b", document: doc({ createdAt: "2026-11-07T00:00:00Z" }) },
      { id: "c", document: doc({ status: "accepted", createdAt: "2026-11-01T00:00:00Z" }) },
      { id: "d", document: doc({ status: "accepted", createdAt: "2026-11-05T00:00:00Z" }) },
    ].map((item) => ({ ...item, line: documentLine(item.document, null) }));
    const ordered = orderDocuments(items);
    expect(ordered.ask.map((item) => item.id)).toEqual(["b", "a"]);
    expect(ordered.done.map((item) => item.id)).toEqual(["d", "c"]);
  });
});
