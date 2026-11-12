/**
 * Free justice in the civil court (phase 3 of the plan of the controladoria, migration 0125) and in the recurso of the
 * small-claims court (0218): each claimant of a lawsuit planned in the civil court, or of a lawsuit of the
 * small-claims court while they appeal, says whether they ask for it, through who gives their word today, and who
 * asks signs a declaration of economic hardship. Pure: what the database answered of a case, where each claimant
 * stands, and the words of each.
 */

/** Where a claimant's answer stands, read with the declaration of who answers for them. */
export type FreeJusticeStanding =
  | "waiting" // nobody answered yet
  | "no_guardian" // a minor nobody answers for yet
  | "declined" // does not ask
  | "issuing" // asks, and ONE issues the declaration
  | "signing" // asks, and the declaration waits for the signature
  | "signed"; // asks, and the declaration is signed

export type FreeJusticeNeed = {
  partyId: string;
  /** The lawsuit the answer is asked for. */
  proceedingId: string | null;
  /** Asked for the recurso of the small-claims court (0218), not for the start of a lawsuit of the civil court. */
  appeal: boolean;
  name: string;
  minor: boolean;
  answererId: string | null;
  answererName: string | null;
  answerId: string | null;
  asks: boolean | null;
  source: "client" | "firm" | null;
  recordedAt: string | null;
  note: string | null;
  /** The state of the envelope of the answerer's declaration, when ONE issued one. */
  paper: string | null;
  /** Whether a proof of income of the answerer arrived. */
  income: boolean;
  standing: FreeJusticeStanding;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The standing of one claimant's answer. */
export function freeJusticeStanding(input: {
  answererId: string | null;
  asks: boolean | null;
  paper: string | null;
}): FreeJusticeStanding {
  if (!input.answererId) return "no_guardian";
  if (input.asks === null) return "waiting";
  if (!input.asks) return "declined";
  if (input.paper === "signed") return "signed";
  // No paper yet, or one that ended (refused, expired, cancelled): ONE has it to issue.
  return input.paper && !["cancelled", "refused", "expired"].includes(input.paper) ? "signing" : "issuing";
}

/** What `case_free_justice` answered; an entry that is not one is left out, never shown wrong. Null when not read. */
export function freeJusticeOf(raw: unknown): FreeJusticeNeed[] | null {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as { ok?: unknown; needs?: unknown };
  if (answer.ok !== true || !Array.isArray(answer.needs)) return null;
  const needs: FreeJusticeNeed[] = [];
  for (const entry of answer.needs as Record<string, unknown>[]) {
    const partyId = text(entry?.party_id);
    const name = text(entry?.name);
    if (!partyId || !name) continue;
    const answererId = text(entry.answerer_id);
    const asks = typeof entry.asks === "boolean" ? entry.asks : null;
    const paper = text(entry.paper);
    needs.push({
      partyId,
      proceedingId: text(entry.proceeding_id),
      appeal: entry.appeal === true,
      name,
      minor: entry.minor === true,
      answererId,
      answererName: text(entry.answerer_name),
      answerId: text(entry.answer_id),
      asks,
      source: entry.source === "client" || entry.source === "firm" ? entry.source : null,
      recordedAt: text(entry.recorded_at),
      note: text(entry.note),
      paper,
      income: entry.income === true,
      standing: freeJusticeStanding({ answererId, asks, paper }),
    });
  }
  return needs;
}

/** The link's view of what its person answers for (`client_link_free_justice`). */
export type ClientFreeJustice = {
  items: {
    partyId: string;
    name: string;
    minor: boolean;
    asks: boolean | null;
    recordedAt: string | null;
    /** Asked for the recurso of the small-claims court (0218): answered whatever the case's stage. */
    appeal: boolean;
  }[];
  /** Whether ONE issued this person's declaration already (it then waits below, to be signed). */
  issued: boolean;
  /** Whether a proof of income of this person arrived. */
  income: boolean;
  /** The party a proof of income of this person is sent as. */
  ownParty: string | null;
};

export function clientFreeJusticeOf(raw: unknown): ClientFreeJustice | null {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (answer.ok !== true || !Array.isArray(answer.items)) return null;
  const items: ClientFreeJustice["items"] = [];
  for (const entry of answer.items as Record<string, unknown>[]) {
    const partyId = text(entry?.party_id);
    const name = text(entry?.name);
    if (!partyId || !name) continue;
    items.push({
      partyId,
      name,
      minor: entry.minor === true,
      asks: typeof entry.asks === "boolean" ? entry.asks : null,
      recordedAt: text(entry.recorded_at),
      appeal: entry.appeal === true,
    });
  }
  return { items, issued: answer.issued === true, income: answer.income === true, ownParty: text(answer.own_party) };
}

const ERROR_KEY: Record<string, string> = {
  how_required: "free-justice-error-how",
  answer_changed: "free-justice-error-changed",
  party_not_found: "free-justice-error-not-found",
  not_asked: "free-justice-error-not-found",
  no_guardian: "free-justice-error-no-guardian",
  too_many: "free-justice-error-too-many",
  link_not_open: "free-justice-error-link",
};

export const freeJusticeErrorKey = (code: string): string => ERROR_KEY[code] ?? "free-justice-error-failed";
