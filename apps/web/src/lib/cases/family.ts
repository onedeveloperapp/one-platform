import { FAMILY_CHOICES, type FamilyChoice } from "@flyee/rules/proceedings";

/**
 * How a family goes to court, and each claimant's word on the civil court
 * (migration 0025, `@flyee/rules/proceedings` v2): the case's choice
 * (together, the default, or split by a lawyer with the reason), what each
 * court decided of a split (`court_notes`, the operator's), and who of a
 * lawsuit planned in the civil court accepted it. Pure: the readers of the
 * database's answers and the screen's words (`product` namespace).
 */

export type FamilyState = {
  choice: FamilyChoice;
  /** Why a lawyer split the family; null for together. */
  reason: string | null;
  /** Who chose and when; null while nobody chose (together, the default). */
  byId: string | null;
  at: string | null;
};

export type CourtNoteSource = { label: string; url: string };

/** What the platform read of how a court decides a family split. */
export type CourtNote = {
  court: string;
  stance: "against" | "divided";
  summary: string;
  sources: CourtNoteSource[];
  readOn: string;
};

/**
 * A claimant of a lawsuit in the civil court, and their word on it: asked while the lawsuit is planned, kept as the
 * firm's record once it is filed.
 */
export type CivilCourtNeed = {
  partyId: string;
  proceedingId: string;
  /** The lawsuit is still planned: the word is asked (and blocks its filing until it is a yes). */
  planned: boolean;
  minor: boolean;
  /** Who gives the word today: the claimant, or who answers for a minor; null when nobody answers for the minor yet. */
  answererId: string | null;
  /** The answer in force of who gives the word today, the one a person of the firm read before recording another. */
  answerId: string | null;
  /** The word in force: null while that person gave none. */
  accepted: boolean | null;
  /** Where it was given, and when. */
  source: "client" | "firm" | null;
  recordedAt: string | null;
  /** How the firm says the person answered, when the firm recorded it. */
  note: string | null;
  /** The words the person is asked in now, with a minor's name written in. */
  wording: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

export const isFamilyChoice = (value: unknown): value is FamilyChoice =>
  (FAMILY_CHOICES as readonly unknown[]).includes(value);

/** The case's columns, as the database keeps them. */
export function familyOf(row: {
  family_choice?: unknown;
  family_choice_reason?: unknown;
  family_choice_by?: unknown;
  family_choice_at?: unknown;
}): FamilyState {
  return {
    choice: isFamilyChoice(row.family_choice) ? row.family_choice : "together",
    reason: text(row.family_choice_reason),
    byId: text(row.family_choice_by),
    at: text(row.family_choice_at),
  };
}

/** The court notes of the family split, as the table keeps them; a row that is not one is left out. */
export function courtNotesOf(rows: unknown): CourtNote[] {
  return (Array.isArray(rows) ? rows : []).flatMap((item): CourtNote[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const court = text(row.court);
    const summary = text(row.summary);
    const readOn = text(row.read_on);
    if (!court || !summary || !readOn || (row.stance !== "against" && row.stance !== "divided")) return [];
    const sources = (Array.isArray(row.sources) ? row.sources : []).flatMap((source): CourtNoteSource[] => {
      const value = (source ?? {}) as Record<string, unknown>;
      const label = text(value.label);
      const url = text(value.url);
      return label && url && url.startsWith("https://") ? [{ label, url }] : [];
    });
    return [{ court, stance: row.stance, summary, sources, readOn }];
  });
}

/** The answer of `case_civil_court`; null when it is not one. */
export function civilCourtOf(raw: unknown): CivilCourtNeed[] | null {
  const answer = (raw ?? {}) as { ok?: unknown; needs?: unknown };
  if (answer.ok !== true || !Array.isArray(answer.needs)) return null;
  return answer.needs.flatMap((item): CivilCourtNeed[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const partyId = text(row.party_id);
    const proceedingId = text(row.proceeding_id);
    if (!partyId || !proceedingId) return [];
    return [
      {
        partyId,
        proceedingId,
        planned: row.planned === true,
        minor: row.minor === true,
        answererId: text(row.answerer_id),
        answerId: text(row.answer_id),
        accepted: typeof row.accepted === "boolean" ? row.accepted : null,
        source: row.source === "client" || row.source === "firm" ? row.source : null,
        recordedAt: text(row.recorded_at),
        note: text(row.note),
        wording: text(row.wording),
      },
    ];
  });
}

/** The note of the court a family's lawsuits would go to, by its state: the court of the domicile. */
export const noteForState = (
  notes: CourtNote[],
  courts: { acronym: string; uf: string | null }[],
  uf: string | null,
): CourtNote | null => {
  if (!uf) return null;
  const court = courts.find((item) => item.uf === uf)?.acronym;
  return court ? (notes.find((note) => note.court === court) ?? null) : null;
};

/** The claimants of a lawsuit still planned whose word on the civil court is missing: none given, or a "no". */
export const civilCourtPending = (needs: CivilCourtNeed[]): CivilCourtNeed[] =>
  needs.filter((need) => need.planned && need.accepted !== true);

export const COURT_NOTE_STANCE_KEY: Record<CourtNote["stance"], string> = {
  against: "case-family-note-against",
  divided: "case-family-note-divided",
};
