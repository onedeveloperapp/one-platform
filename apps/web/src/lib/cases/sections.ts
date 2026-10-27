import type { CaseStatus } from "@/lib/cases/cases";

/** The cards of the case screen, each of which a person may open or close. */
export const CASE_SECTIONS = [
  "people",
  "trip",
  "statements",
  "documents",
  "complaints",
  "signatures",
  "rules",
  "proceedings",
  "deadlines",
  "hearings",
  "drafts",
  "filing",
  "link",
  "notices",
  "summary",
  "dossier",
  "timeline",
] as const;
export type CaseSection = (typeof CASE_SECTIONS)[number];

/** What the case's facts and story say on every stage: short, and read before anything else. */
const ALWAYS: readonly CaseSection[] = ["summary", "timeline"];

/**
 * The cards each stage of a case is about. While the case is gathered the
 * firm works with the client (who they are, the trip, what they told, their
 * papers and signatures, their link); in the drafting it turns the case into
 * lawsuits, their pieces and their packages; once filed, it follows the
 * court. An ended case opens nothing but its facts and its story.
 */
const STAGE_SECTIONS: Record<CaseStatus, readonly CaseSection[]> = {
  intake: ["people", "trip", "statements", "documents", "link"],
  documents: ["people", "trip", "statements", "documents", "link"],
  signature: ["documents", "signatures", "link"],
  drafting: ["proceedings", "drafts", "filing"],
  ready: ["proceedings", "drafts", "filing"],
  filed: ["proceedings", "deadlines", "hearings", "notices"],
  closed: [],
  declined: [],
};

/** The case is still the firm's to prepare: not with the court yet, and not ended. */
export const beforeCourt = (status: CaseStatus): boolean =>
  status !== "filed" && status !== "closed" && status !== "declined";

/**
 * Whether a card opens when the person arrives: when something in it waits
 * for a person now, or when the stage is about it and it holds something (an
 * empty card says so closed, and the case's list of what it lacks names what
 * is missing). Read once on arrival, so a card never opens or closes by
 * itself under the person's hands.
 */
export function opensOnArrival(status: CaseStatus, section: CaseSection, waits: boolean, empty = false): boolean {
  return waits || ALWAYS.includes(section) || (!empty && STAGE_SECTIONS[status].includes(section));
}
