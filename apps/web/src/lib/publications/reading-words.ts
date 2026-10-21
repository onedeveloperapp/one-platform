/**
 * What the firm reads of ONE's reading of a publication (migration 0040),
 * in the screens' words: the kinds, the states, why ONE left a publication
 * to a person and what the person does then, and which reading a card
 * shows. Pure and light: the screens that run in the browser import it,
 * never the reader of a court's text.
 */

export const READING_KINDS = ["deadline", "hearing"] as const;
export type ReadingKind = (typeof READING_KINDS)[number];
export const isReadingKind = (value: unknown): value is ReadingKind =>
  typeof value === "string" && (READING_KINDS as readonly string[]).includes(value);

/** The kind a category of a triage owes, when it owes one. */
export const readingKindOf = (category: string | null | undefined): ReadingKind | null =>
  category === "prazo" ? "deadline" : category === "audiencia" ? "hearing" : null;

/**
 *   due      ONE is reading it, or will in a moment;
 *   done     ONE recorded what it read (the deadline proposed, the hearing written), or found the hearing in
 *            the agenda already;
 *   unread   ONE left it to a person, with why;
 *   failed   ONE could not read it, or not in time;
 *   skipped  nothing of ONE's to say: a person did it first, the triage changed, the firm reads by hand.
 */
export const READING_STATUSES = ["due", "done", "unread", "failed", "skipped"] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];
export const isReadingStatus = (value: unknown): value is ReadingStatus =>
  typeof value === "string" && (READING_STATUSES as readonly string[]).includes(value);

/** What the firm reads of a reading. */
export type PublicationReading = { kind: ReadingKind; status: ReadingStatus; reason: string | null };

/** A reading with something of ONE's to say. */
export type ShownReading = { kind: ReadingKind; status: Exclude<ReadingStatus, "skipped">; reason: string | null };

/** Why ONE left a publication to a person, in the firm's words; anything else is said as "could not record". */
const REASON_KEY: Record<string, string> = {
  too_old: "publication-reading-reason-too-old",
  not_filed: "publication-reading-reason-not-filed",
  no_term: "publication-reading-reason-no-term",
  days_unread: "publication-reading-reason-days-unread",
  other_start: "publication-reading-reason-other-start",
  struck_text: "publication-reading-reason-struck",
  excerpt_not_in_text: "publication-reading-reason-excerpt",
  days_not_in_excerpt: "publication-reading-reason-days",
  several_terms: "publication-reading-reason-several-terms",
  text_truncated: "publication-reading-reason-truncated",
  other_units: "publication-reading-reason-other-units",
  intimated_in_hearing: "publication-reading-reason-intimated-in-hearing",
  no_hearing: "publication-reading-reason-no-hearing",
  hearing_moved: "publication-reading-reason-hearing-moved",
  hearing_cancelled: "publication-reading-reason-hearing-cancelled",
  no_new_hearing: "publication-reading-reason-no-new-hearing",
  hearing_changed: "publication-reading-reason-hearing-changed",
  judgment_session: "publication-reading-reason-judgment",
  not_a_hearing: "publication-reading-reason-not-a-hearing",
  several_dates: "publication-reading-reason-several-dates",
  several_times: "publication-reading-reason-several-times",
  zone_named: "publication-reading-reason-zone-named",
  conflicting_hearing: "publication-reading-reason-conflicting",
  date_unread: "publication-reading-reason-date-unread",
  date_not_in_excerpt: "publication-reading-reason-date",
  time_not_in_excerpt: "publication-reading-reason-time",
  time_unlikely: "publication-reading-reason-time-unlikely",
  past: "publication-reading-reason-past",
  mode_unclear: "publication-reading-reason-mode",
  place_not_in_text: "publication-reading-reason-place",
  link_not_in_text: "publication-reading-reason-link",
  zone_required: "publication-reading-reason-zone",
};
export const readingReasonKey = (reason: string | null | undefined): string =>
  (reason && REASON_KEY[reason]) || "publication-reading-reason-other";

/** What a person does with a publication ONE left to them: most often the work by hand; a hearing moved or cancelled is changed in the agenda. */
export function readingAdviceKey(kind: ReadingKind, reason: string | null | undefined): string {
  if (kind === "deadline")
    return reason === "no_term" ? "publication-reading-advice-no-term" : "publication-reading-advice-deadline";
  if (reason === "not_filed") return "publication-reading-advice-not-filed";
  if (reason === "hearing_moved") return "publication-reading-advice-hearing-moved";
  if (reason === "hearing_cancelled") return "publication-reading-advice-hearing-cancelled";
  if (reason === "hearing_changed") return "publication-reading-advice-hearing-changed";
  if (reason === "conflicting_hearing") return "publication-reading-advice-conflicting";
  if (reason === "no_hearing" || reason === "no_new_hearing") return "publication-reading-advice-no-hearing";
  return "publication-reading-advice-hearing";
}

/** What the screen says of a reading of each kind, by its state; nothing for one skipped. */
export const READING_STATUS_KEY: Record<ReadingKind, Record<Exclude<ReadingStatus, "skipped">, string>> = {
  deadline: {
    due: "publication-reading-deadline-due",
    done: "publication-reading-deadline-done",
    unread: "publication-reading-deadline-unread",
    failed: "publication-reading-deadline-failed",
  },
  hearing: {
    due: "publication-reading-hearing-due",
    done: "publication-reading-hearing-done",
    unread: "publication-reading-hearing-unread",
    failed: "publication-reading-hearing-failed",
  },
};

/** The key of what the screen says of a reading: a hearing ONE found in the agenda already has its own words. */
export const readingStatusKey = (reading: ShownReading): string =>
  reading.kind === "hearing" && reading.status === "done" && reading.reason === "already_in_agenda"
    ? "publication-reading-hearing-in-agenda"
    : READING_STATUS_KEY[reading.kind][reading.status];

/** Why who writes hearings could not say a publication's hearing needs nothing more (`settle_publication_hearing`). */
const SETTLE_ERROR_KEY: Record<string, string> = {
  not_found: "agenda-unwritten-settle-error-not-found",
  not_allowed: "agenda-unwritten-settle-error-not-allowed",
  not_allowed_in_support_session: "agenda-unwritten-settle-error-support",
  cancelled: "agenda-unwritten-settle-error-cancelled",
  invalid_category: "agenda-unwritten-settle-error-retriaged",
};
export const settleErrorKey = (code: string): string =>
  SETTLE_ERROR_KEY[code] ?? "agenda-unwritten-settle-error-failed";

/** The readings the database answered, read as nothing more than they may be; one per publication and kind. */
export function readingsOf(raw: unknown): Map<string, PublicationReading[]> {
  const found = new Map<string, PublicationReading[]>();
  if (!Array.isArray(raw)) return found;
  for (const item of raw) {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.publication_id !== "string" || !isReadingKind(row.kind) || !isReadingStatus(row.status)) continue;
    const list = found.get(row.publication_id) ?? [];
    if (list.some((reading) => reading.kind === row.kind)) continue;
    list.push({
      kind: row.kind,
      status: row.status,
      reason: typeof row.reason === "string" && /^[a-z][a-z0-9_]{1,59}$/.test(row.reason) ? row.reason : null,
    });
    found.set(row.publication_id, list);
  }
  return found;
}

/**
 * The reading a publication shows for the category it has now. A triage the
 * person just made that asked ONE to read (`justAsked`: none once what was
 * read is newer than that triage) says ONE is reading, unless what was read
 * says what came of it; otherwise what was read. None for a category that
 * owes none, or a reading with nothing of ONE's to say.
 */
export function shownReading(
  category: string | null | undefined,
  readings: readonly PublicationReading[],
  justAsked: ReadingKind | null,
): ShownReading | null {
  const kind = readingKindOf(category);
  if (!kind) return null;
  const found = readings.find((reading) => reading.kind === kind);
  const settled = found && found.status !== "due" && found.status !== "skipped";
  if (justAsked === kind && !settled) return { kind, status: "due", reason: null };
  if (!found || found.status === "skipped") return null;
  return { kind: found.kind, status: found.status, reason: found.reason };
}

/**
 * The reading a card shows from what the screen knows: what was read of the
 * publication (`readAt`, by the screen's clock) and the triage the person
 * made (`askedAt`). Until something is read after that triage, a triage that
 * asked ONE to read says ONE is reading; once something is, what was read is
 * the word: a reading ONE skipped since (a person did it first, the firm
 * holds it) says nothing more.
 */
export function readingOnCard(
  category: string | null | undefined,
  readings: readonly PublicationReading[],
  justAsked: ReadingKind | null,
  askedAt: number | undefined,
  readAt: number | undefined,
): ShownReading | null {
  const newer = askedAt !== undefined && readAt !== undefined && readAt > askedAt;
  return shownReading(category, readings, newer ? null : justAsked);
}
