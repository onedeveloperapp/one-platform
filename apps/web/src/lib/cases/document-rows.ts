import type { ResidenceView } from "@/lib/cases/residence";

/**
 * Where a document of a case stands, as its line says it (the owner's canvas "ONE · Publicações no caso",
 * 2026-11-10): what asks the firm (a document to decide, ONE's suggestion said; a bill whose address is of another
 * city than the record's), what ONE is checking, and what is decided. Pure: the card of the case reads it, a test
 * keeps it.
 */
export type DocumentPlace = "ask" | "working" | "done";

export type DocumentLine = {
  place: DocumentPlace;
  tone: "attention" | "waiting" | "done" | "info";
  key: string;
  /** The reason ONE gave to refuse, or the reason the firm refused it with: the card says it in its words. */
  reason: string | null;
};

/** As much of a document as its line reads. */
export type DocumentForLine = {
  status: "received" | "accepted" | "rejected";
  processing: "pending" | "working" | "done" | "skipped" | "failed";
  check: { waiting: boolean; answer: { decision?: string; reason?: string | null } } | null;
  rejectedReason: string | null;
  createdAt: string;
};

export function documentLine(
  document: DocumentForLine,
  residence: Pick<ResidenceView, "standing"> | null,
): DocumentLine {
  const line = (place: DocumentPlace, tone: DocumentLine["tone"], key: string, reason: string | null = null) => ({
    place,
    tone,
    key,
    reason,
  });
  if (document.status === "received") {
    if (document.check?.waiting) {
      if (document.check.answer.decision !== "recusar")
        return line("ask", "attention", "case-rows-doc-suggests-accept");
      const reason = document.check.answer.reason ?? null;
      return reason
        ? line("ask", "attention", "case-rows-doc-suggests-refuse", reason)
        : line("ask", "attention", "case-rows-doc-suggests-refuse-plain");
    }
    if (document.processing === "pending" || document.processing === "working") {
      return line("working", "waiting", "case-rows-doc-checking");
    }
    if (document.processing === "failed") return line("ask", "attention", "case-rows-doc-check-failed");
    return line("ask", "attention", "case-rows-doc-to-review");
  }
  if (document.status === "rejected") {
    return line(
      "done",
      "info",
      document.rejectedReason ? "case-rows-doc-refused-reason" : "case-rows-doc-refused",
      document.rejectedReason,
    );
  }
  // Accepted: a bill in somebody else's name owes the client's declaration of residence (0123).
  if (residence?.standing === "conflict") return line("ask", "attention", "case-rows-doc-residence-conflict");
  if (
    residence &&
    (residence.standing === "asking" || residence.standing === "issuing" || residence.standing === "signing")
  ) {
    return line("done", "waiting", "case-rows-doc-residence-waiting");
  }
  return line("done", "done", "case-rows-doc-accepted");
}

/** The documents of a case in the order of their lines: what asks first (the oldest first), ONE's work, the rest newest first. */
export function orderDocuments<T extends { document: { createdAt: string }; line: DocumentLine }>(items: readonly T[]) {
  const by = (direction: 1 | -1) => (a: T, b: T) =>
    direction * a.document.createdAt.localeCompare(b.document.createdAt);
  return {
    ask: items.filter((item) => item.line.place === "ask").sort(by(1)),
    working: items.filter((item) => item.line.place === "working").sort(by(1)),
    done: items.filter((item) => item.line.place === "done").sort(by(-1)),
  };
}
