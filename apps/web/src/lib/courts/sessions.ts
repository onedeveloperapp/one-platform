/**
 * The sessions of judgment of an appeal and the registration for oral argument (migration 0219): what the case reads
 * of them, and where each stands, in the words of its line. Pure.
 */

export type JudgmentSession = {
  id: string;
  proceedingId: string;
  kind: "virtual" | "presencial";
  startsOn: string;
  /** "HH:MM", when the pauta says it. */
  startsAt: string | null;
  status: "scheduled" | "withdrawn";
  withdrawReason: string | null;
  source: "publication" | "person";
  /** Whether the limit was counted for the session as it is now. */
  counted: boolean;
  limitOn: string | null;
  limitHour: string | null;
  limitBasis: string | null;
  /** Why the limit could not be counted (no rule of the court, no calendar). */
  limitError: string | null;
  oralChoice: "registered" | "declined" | null;
  oralBy: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const day = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const hour = (value: unknown): string | null =>
  typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value) ? value.slice(0, 5) : null;

/** What `case_judgment_sessions` answered; an entry that is not one is left out. Null when not read. */
export function sessionsOf(raw: unknown): JudgmentSession[] | null {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as { ok?: unknown; sessions?: unknown };
  if (answer.ok !== true || !Array.isArray(answer.sessions)) return null;
  const sessions: JudgmentSession[] = [];
  for (const entry of answer.sessions as Record<string, unknown>[]) {
    const id = text(entry?.id);
    const proceedingId = text(entry?.proceeding_id);
    const startsOn = day(entry?.starts_on);
    if (!id || !proceedingId || !startsOn || (entry.kind !== "virtual" && entry.kind !== "presencial")) continue;
    sessions.push({
      id,
      proceedingId,
      kind: entry.kind,
      startsOn,
      startsAt: hour(entry.starts_at),
      status: entry.status === "withdrawn" ? "withdrawn" : "scheduled",
      withdrawReason: text(entry.withdraw_reason),
      source: entry.source === "person" ? "person" : "publication",
      counted: entry.counted === true,
      limitOn: day(entry.limit_on),
      limitHour: hour(entry.limit_hour),
      limitBasis: text(entry.limit_basis),
      limitError: text(entry.limit_error),
      oralChoice: entry.oral_choice === "registered" || entry.oral_choice === "declined" ? entry.oral_choice : null,
      oralBy: text(entry.oral_by),
    });
  }
  return sessions;
}

/** Where the registration for oral argument of a session stands. */
export type OralStanding =
  | "registered" // the firm registered in the court's system
  | "declined" // the firm will not argue
  | "counting" // ONE is counting the limit
  | "uncounted" // the limit could not be counted: the court has no rule here, or its calendar could not be read
  | "open" // the limit is to come: the firm says whether it argues
  | "passed"; // the limit passed and nobody said

/** The standing of a scheduled session's registration, on a day ("YYYY-MM-DD") at an hour ("HH:MM") of Brasília. */
export function oralStanding(session: JudgmentSession, today: string, now: string): OralStanding {
  if (session.oralChoice) return session.oralChoice;
  if (!session.counted) return "counting";
  if (!session.limitOn || session.limitError) return "uncounted";
  if (session.limitOn > today) return "open";
  if (session.limitOn < today) return "passed";
  return session.limitHour === null || now < session.limitHour ? "open" : "passed";
}

/** The session a lawsuit shows: the one to come (the nearest), else the latest. */
export function sessionToShow(sessions: readonly JudgmentSession[], proceedingId: string): JudgmentSession | null {
  const own = sessions.filter((session) => session.proceedingId === proceedingId);
  const scheduled = own
    .filter((session) => session.status === "scheduled")
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  return scheduled[0] ?? own[0] ?? null;
}

const ERROR_KEY: Record<string, string> = {
  not_found: "session-error-not-found",
  not_filed: "session-error-not-filed",
  already: "session-error-already",
  not_open: "session-error-not-open",
  not_allowed: "session-error-not-allowed",
  invalid_data: "session-error-invalid",
};

export const sessionErrorKey = (code: string): string => ERROR_KEY[code] ?? "session-error-failed";
