/**
 * The declaration of residence (phase 3 of the plan of the controladoria, migration 0123): a bill in somebody else's
 * name the firm accepted owes the client's declaration, which goes to the court with the bill. Pure: what the database
 * answered of a case's declarations, where each stands, who the holder may be to the client, and the words of each.
 */

/** Who the holder of the bill may be to the client, as the declaration writes it. */
export const RESIDENCE_RELATIONS = [
  "mae",
  "pai",
  "conjuge",
  "filho",
  "irmao",
  "avo",
  "parente",
  "proprietario",
  "outro",
] as const;
export type ResidenceRelation = (typeof RESIDENCE_RELATIONS)[number];
export const isResidenceRelation = (value: unknown): value is ResidenceRelation =>
  (RESIDENCE_RELATIONS as readonly unknown[]).includes(value);

export const RELATION_KEY: Record<ResidenceRelation, string> = {
  mae: "residence-relation-mae",
  pai: "residence-relation-pai",
  conjuge: "residence-relation-conjuge",
  filho: "residence-relation-filho",
  irmao: "residence-relation-irmao",
  avo: "residence-relation-avo",
  parente: "residence-relation-parente",
  proprietario: "residence-relation-proprietario",
  outro: "residence-relation-outro",
};

/**
 * Where a declaration stands: the client's word on the holder (`asking`), an address on record in another city that
 * waits for a person (`conflict`), ONE about to issue it (`issuing`), the client signing it (`signing`), signed and
 * going to the court (`signed`), a partner or a lawyer went on without it (`waived`), or a document of the client's
 * link to the holder settled it (`linked`, 0294).
 */
export type ResidenceStanding = "asking" | "conflict" | "issuing" | "signing" | "signed" | "waived" | "linked";

/** The latest document of the client's link to the holder (0294): sent and being checked, accepted, or refused. */
export type ResidenceLink = { id: string; status: "received" | "accepted" | "rejected"; reason: string | null };

export type ResidenceView = {
  id: string;
  personId: string;
  documentId: string;
  /** The holder's name as it stands, and as ONE read it on the bill. */
  holder: string;
  holderRead: string;
  relation: ResidenceRelation | null;
  note: string | null;
  answeredBy: "client" | "firm" | null;
  billCity: string | null;
  standing: ResidenceStanding;
  endedReason: string | null;
  /** The latest document of the link, of an open declaration or of the one it settled (0294). */
  link: ResidenceLink | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

const nameKey = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Whether the holder's name was corrected after ONE read it: the database writes the name read as a name ("JOANA
 * TESTE" becomes "Joana Teste"), which is no correction; another word is.
 */
export const holderCorrected = (view: Pick<ResidenceView, "holder" | "holderRead">): boolean =>
  nameKey(view.holder) !== nameKey(view.holderRead);

/** The standing of one declaration, by what keeps it from the filing and where its envelope stands. */
export function residenceStanding(status: unknown, blocker: unknown, envelope: unknown): ResidenceStanding {
  if (status === "waived") return "waived";
  // Settled by a document of the link (0294): only a city of the bill other than the record still waits.
  if (status === "linked") return blocker === "residence_address_conflict" ? "conflict" : "linked";
  if (blocker === "residence_relation_missing") return "asking";
  if (blocker === "residence_address_conflict") return "conflict";
  if (blocker === "residence_declaration_unsigned") {
    // No envelope yet, or one that ended (the client refused it, it expired): ONE has it to issue or the firm to see.
    return typeof envelope === "string" && envelope !== "cancelled" && envelope !== "refused" && envelope !== "expired"
      ? "signing"
      : "issuing";
  }
  return "signed";
}

/** What `case_residence` answered; an entry that is not one is left out, never shown wrong. */
export function residenceViewsOf(raw: unknown): ResidenceView[] {
  if (!Array.isArray(raw)) return [];
  const views: ResidenceView[] = [];
  for (const entry of raw as Record<string, unknown>[]) {
    const id = text(entry?.id);
    const personId = text(entry?.person_id);
    const documentId = text(entry?.document_id);
    const holder = text(entry?.holder);
    if (!id || !personId || !documentId || !holder) continue;
    if (entry.status !== "open" && entry.status !== "waived" && entry.status !== "linked") continue;
    const link = (typeof entry.link === "object" && entry.link !== null ? entry.link : {}) as Record<string, unknown>;
    const linkId = text(link.id);
    views.push({
      id,
      personId,
      documentId,
      holder,
      holderRead: text(entry.holder_read) ?? holder,
      relation: isResidenceRelation(entry.relation) ? entry.relation : null,
      note: text(entry.note),
      answeredBy: entry.answered_source === "client" || entry.answered_source === "firm" ? entry.answered_source : null,
      billCity: text(entry.bill_city),
      standing: residenceStanding(entry.status, entry.blocker, entry.envelope),
      endedReason: text(entry.ended_reason),
      link:
        linkId && (link.status === "received" || link.status === "accepted" || link.status === "rejected")
          ? { id: linkId, status: link.status, reason: text(link.reason) }
          : null,
    });
  }
  return views;
}

/** What a request to record who the holder is carries, checked before the database checks it again. */
export function relationInputOf(
  input: unknown,
): { ok: true; relation: ResidenceRelation; note: string | null; holder: string } | { ok: false; code: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  if (!isResidenceRelation(value.relation)) return { ok: false, code: "relation" };
  const note = typeof value.note === "string" ? value.note.trim().replace(/\s+/g, " ") : "";
  if (value.relation === "outro" && (note.length < 2 || note.length > 60)) return { ok: false, code: "note" };
  const holder = typeof value.holder === "string" ? value.holder.trim().replace(/\s+/g, " ") : "";
  if (holder !== "" && (holder.length < 2 || holder.length > 120)) return { ok: false, code: "holder" };
  return { ok: true, relation: value.relation, note: value.relation === "outro" ? note : null, holder };
}

const ERROR_KEY: Record<string, string> = {
  relation: "residence-error-relation",
  note: "residence-error-note",
  holder: "residence-error-holder",
  issued: "residence-error-issued",
  not_found: "residence-error-not-found",
  not_allowed: "residence-error-not-allowed",
  second_factor: "residence-error-second-factor",
  reason: "residence-error-reason",
  link_not_open: "residence-error-link",
};

export const residenceErrorKey = (code: string): string => ERROR_KEY[code] ?? "residence-error-failed";
