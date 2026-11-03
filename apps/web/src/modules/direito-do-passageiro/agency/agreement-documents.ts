import type { AgreementDocument, AgreementPerson } from "@/modules/direito-do-passageiro/agency/agreement";
import type { PaxDocumentKind } from "@/modules/direito-do-passageiro/agency/passengers";

/**
 * Where the passenger's documents stand on their link (the owner, 2026-11-03): what the firm needs of each person
 * is asked for in view while it has not arrived, or arrived in a way that does not serve; what arrived and serves
 * is said as done, and sending it again is a choice kept one click away, never a button that asks for it again.
 * A passenger whose agency already sent their identity was shown "Enviar identidade" as if nothing had arrived.
 * Pure: the screen reads it.
 */

/** How one document stands: it serves, it is being read, or it does not serve as it is. */
export type DocumentStanding = "fine" | "reading" | "problem";

export function documentStanding(document: AgreementDocument): DocumentStanding {
  if (document.reading === "pending" || document.reading === "working") return "reading";
  // ONE could not read it: it arrived, and a person of the firm looks at it.
  if (document.reading === "failed") return "fine";
  if (document.matches === false || document.legible === false) return "problem";
  return "fine";
}

/** What the firm needs of a person: an identity of everybody, a proof of address of the adult the link is for. */
export type NeededKind = Extract<PaxDocumentKind, "identity" | "address_proof">;

export type NeededDocument = {
  kind: NeededKind;
  /** What was sent of that kind, in the order the link has it. */
  documents: AgreementDocument[];
  /** The best of what was sent: one that serves is enough, whatever else of its kind came. */
  standing: DocumentStanding | "missing";
};

export function neededDocuments(person: AgreementPerson): NeededDocument[] {
  const kinds: NeededKind[] = person.isHolder ? ["identity", "address_proof"] : ["identity"];
  return kinds.map((kind) => {
    const documents = person.documents.filter((document) => document.kind === kind);
    const standings = new Set(documents.map(documentStanding));
    const standing = standings.has("fine")
      ? "fine"
      : standings.has("reading")
        ? "reading"
        : standings.has("problem")
          ? "problem"
          : "missing";
    return { kind, documents, standing };
  });
}

/**
 * Where the documents of everybody on the link stand: `complete` once every one the firm needs serves, `problem`
 * while one sent does not serve and nothing else of its kind does, `reading` while ONE reads one, `open` while
 * something is still to send (which the passenger may leave: sending is their choice).
 */
export type DocumentsStanding = "complete" | "problem" | "reading" | "open";

export function documentsStanding(people: AgreementPerson[]): DocumentsStanding {
  const needed = people.flatMap(neededDocuments);
  if (needed.length > 0 && needed.every((item) => item.standing === "fine")) return "complete";
  if (needed.some((item) => item.standing === "problem")) return "problem";
  if (needed.some((item) => item.standing === "reading")) return "reading";
  return "open";
}
