import type { PublicationCategory } from "@/lib/publications/publications";
import type { ReadingKind } from "@/lib/publications/reading-words";

/**
 * The list of publications a person is working through, as the screen holds
 * it. What the server read is where it starts: a publication the person
 * triages stays where it is, with the word they gave it, until they ask for
 * the next ones. So a wrong click is put right on the spot, the place the
 * person is at does not move under them, and the count they are working
 * down is theirs. The list is read again from the server only when the
 * person asks for it (another list, another page, the next ones), never
 * because an answer was saved: an answer that is saved reads the page again
 * behind the screen, and what comes of that is not shown here.
 *
 * Pure: the screen keeps one of these and replaces it by what these
 * functions give.
 */

export type ListCounts = { untriaged: number; review: number; triaged: number; cancelled: number };

export type Said = {
  category: PublicationCategory;
  note: string | null;
  /** ONE reads the deadline or the hearing this triage set (0040): the answer of the triage said so. */
  reading?: ReadingKind | null;
  /** When the triage was saved, by the screen's own clock: what is read after it is newer than it. */
  at?: number;
};

export type HeldList<Row extends { id: string }> = {
  /** The publications of the list, as they were read. */
  rows: Row[];
  /** How many there were of each kind when the list was read. */
  counts: ListCounts;
  /** What the person said of a publication since then, of this list or of one they searched for. */
  said: Record<string, Said>;
  /** The publications that had no word before and got one since then. */
  first: string[];
  /** The cancellings the person said they saw since then. */
  seen: string[];
  /** The AI's triage waiting for a check that the person checked since then. */
  checked: string[];
};

export function holdList<Row extends { id: string }>(rows: readonly Row[], counts: ListCounts): HeldList<Row> {
  return { rows: [...rows], counts: { ...counts }, said: {}, first: [], seen: [], checked: [] };
}

/**
 * The person said what a publication is. `had` is the word the publication
 * had when it was read (none, for one still to triage): a first word moves
 * one from "to triage" to "triaged", a changed one moves nothing. `checking`
 * says the word was the check of the AI's triage that waited for one: it
 * leaves the list of what to check.
 */
export function withSaid<Row extends { id: string }>(
  held: HeldList<Row>,
  id: string,
  had: PublicationCategory | null,
  said: Said,
  checking = false,
): HeldList<Row> {
  const first = had === null && !(id in held.said) && !held.first.includes(id);
  return {
    ...held,
    said: { ...held.said, [id]: said },
    first: first ? [...held.first, id] : held.first,
    checked: checking && !held.checked.includes(id) ? [...held.checked, id] : held.checked,
  };
}

/** The person said they saw that a court cancelled a publication. */
export function withSeen<Row extends { id: string }>(held: HeldList<Row>, id: string): HeldList<Row> {
  return held.seen.includes(id) ? held : { ...held, seen: [...held.seen, id] };
}

/** The counts as the person's work changed them since the list was read. */
export function countsNow<Row extends { id: string }>(held: HeldList<Row>): ListCounts {
  const moved = held.first.length;
  return {
    untriaged: Math.max(held.counts.untriaged - moved, 0),
    review: Math.max(held.counts.review - held.checked.length, 0),
    triaged: held.counts.triaged + moved,
    cancelled: held.counts.cancelled,
  };
}

/** How many publications of the list itself got their first word since it was read: they are still shown in it. */
export function triagedInList<Row extends { id: string }>(held: HeldList<Row>): number {
  const inList = new Set(held.rows.map((row) => row.id));
  return held.first.filter((id) => inList.has(id)).length;
}
