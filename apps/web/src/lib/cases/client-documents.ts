import { type CaseDocumentState, type DocumentNeed, documentsFor } from "@/lib/cases/cases";

/**
 * Where the documents stand on a client's link (the owner, 2026-11-03): each document the firm needs is one line
 * that says how it stands, and asks for a file only while nothing sent for it serves; the card says first whether
 * anything is still owed. Pure: the link's card reads it.
 */

/**
 * How one need stands from what was sent for it: one the firm accepted is enough, whatever else came; then one the
 * firm has not decided yet (the client sent another after a refusal); then a refusal; else nothing came.
 */
export type NeedStanding = "accepted" | "received" | "rejected" | "missing";

export function needStanding(sent: readonly Pick<CaseDocumentState, "status">[]): NeedStanding {
  const statuses = new Set(sent.map((document) => document.status));
  if (statuses.has("accepted")) return "accepted";
  if (statuses.has("received")) return "received";
  if (statuses.has("rejected")) return "rejected";
  return "missing";
}

/** Whether the client still owes something for a need: nothing came, or only what the firm refused. */
export const isOwed = (standing: NeedStanding) => standing === "missing" || standing === "rejected";

/**
 * Where the documents of the link stand: `owed` while a need has nothing that serves (the same reading as "what is
 * still missing" above it, so the two never disagree), `checking` once each has something the firm has not decided
 * every part of, `complete` once the firm accepted one for each, `none` when the setting asks for no document.
 */
export type DocumentsStanding = { state: "none" | "owed" | "checking" | "complete"; owed: number };

export function documentsStanding(needs: readonly DocumentNeed[], documents: CaseDocumentState[]): DocumentsStanding {
  if (needs.length === 0) return { state: "none", owed: 0 };
  const standings = needs.map((need) => needStanding(documentsFor(need, documents)));
  const owed = standings.filter(isOwed).length;
  if (owed > 0) return { state: "owed", owed };
  if (standings.includes("received")) return { state: "checking", owed: 0 };
  return { state: "complete", owed: 0 };
}

/** What was sent that answers no need (a receipt, a photo of what happened, another paper), in the order it came. */
export function extraDocuments<D extends CaseDocumentState>(needs: readonly DocumentNeed[], documents: D[]): D[] {
  return documents.filter((document) => !needs.some((need) => documentsFor(need, [document]).length > 0));
}

/** The refusal a need is shown with while nothing sent for it serves: the latest the firm refused. */
export function latestRefusal<D extends CaseDocumentState & { created_at: string }>(sent: D[]): D | null {
  return sent
    .filter((document) => document.status === "rejected")
    .reduce<D | null>(
      (latest, document) =>
        latest === null || (Date.parse(document.created_at) || 0) > (Date.parse(latest.created_at) || 0)
          ? document
          : latest,
      null,
    );
}

/** A dispensable document of a case (0177): asked once; the case goes on with "não tenho" or after some days. */
/** `later`: asked only once the case is signed (0181), where ONE sends the papers. */
export type Dispensable = { kind: string; label: string; state: "sent" | "not_have" | "expired" | "asked" | "later" };

const DISPENSABLE_STATES: readonly Dispensable["state"][] = ["sent", "not_have", "expired", "asked", "later"];

/** The dispensables as the database answers them (`case_document_needs`); what is not one is left out. */
export function dispensablesOf(raw: unknown): Dispensable[] {
  const list = (raw as { dispensable?: unknown } | null)?.dispensable;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): Dispensable[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const state = row.state as Dispensable["state"];
    return typeof row.kind === "string" && typeof row.label === "string" && DISPENSABLE_STATES.includes(state)
      ? [{ kind: row.kind, label: row.label, state }]
      : [];
  });
}
