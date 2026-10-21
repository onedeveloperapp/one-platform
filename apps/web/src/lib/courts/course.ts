import type { CourtMovement, CourtProceeding } from "@flyee/courts/types";

/**
 * The course of a lawsuit ("andamento", migration 0031), as the backend
 * keeps it and the screens say it. Pure: what is kept of what a source read,
 * when TJGO's Projudi is read by routine, and the words of each state.
 */

/** The most of each list of what the court shows that is kept of one reading. */
const MOST_LISTED = 50;

/** What is kept of what the court shows: the lawsuit as the source read it, its lists cut short, and the source. */
export function snapshotOf(proceeding: CourtProceeding, vendor: string): Record<string, unknown> {
  return {
    ...proceeding,
    subjects: proceeding.subjects.slice(0, 10),
    lawyers: proceeding.lawyers.slice(0, MOST_LISTED),
    responsibles: proceeding.responsibles.slice(0, 10),
    pending: proceeding.pending.slice(0, MOST_LISTED),
    vendor,
  };
}

const SAFE_ID = /^[A-Za-z0-9._:-]{1,100}$/;

/**
 * A movement's id as the database keeps it: as the source gave it, or, when it carries other characters or
 * is too long, a stable name made of it (the same id always gives the same name, so a reading twice keeps
 * it once).
 */
export function movementId(id: string): string {
  if (SAFE_ID.test(id)) return id;
  let hash = 0x811c9dc5;
  let other = 0x01000193;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x01000193) >>> 0;
    other = Math.imul(other ^ id.charCodeAt(id.length - 1 - index), 0x811c9dc5) >>> 0;
  }
  return `h${hash.toString(36)}${other.toString(36)}${id.length.toString(36)}`;
}

/** The most movements one reading keeps: the latest, when a lawsuit has more. */
export const MOST_MOVEMENTS = 5000;

/** The movements as the database takes them (oldest first, the latest ones when a lawsuit has more). */
export const movementsOf = (movements: readonly CourtMovement[]) =>
  movements.slice(-MOST_MOVEMENTS).map((movement) => ({
    id: movementId(movement.id),
    at: movement.at,
    title: movement.title.slice(0, 1000),
    detail: movement.detail ? movement.detail.slice(0, 4000) : null,
    by: movement.by ? movement.by.slice(0, 300) : null,
  }));

/**
 * Whether an instant falls in the hours of Brasília the routine readings of Projudi go in, from one hour to
 * the other (22 to 6 crosses midnight). The same hour twice is every hour.
 */
export function inProjudiHours(instant: number, from: number, to: number): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(
      new Date(instant),
    ),
  );
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** A failure's message as the database keeps it: a code of letters, digits and underscores. */
export function failureCode(error: unknown): string {
  const said = error instanceof Error ? error.message : "";
  const code = said
    .toLowerCase()
    .split(":")[0]
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return /^[a-z][a-z0-9_]{1,59}$/.test(code) ? code : "source_failed";
}

export type CourseStatus = "waiting" | "tracked" | "not_found" | "secret" | "failed" | "off";
export const COURSE_STATUSES: readonly CourseStatus[] = ["waiting", "tracked", "not_found", "secret", "failed", "off"];
export const isCourseStatus = (value: unknown): value is CourseStatus =>
  (COURSE_STATUSES as readonly unknown[]).includes(value);

/** What a person's request of a reading answered, by the code the database or the server gave. */
const ERROR_KEY: Record<string, string> = {
  read_cooldown: "course-error-cooldown",
  not_tracked: "course-error-not-tracked",
  proceeding_not_found: "course-error-not-found",
  case_not_found: "course-error-not-found",
  not_allowed_in_support_session: "course-error-support",
};
export const courseErrorKey = (code: string): string => ERROR_KEY[code] ?? "course-error-failed";

/** The codes the database answers a person with (migration 0031), each of which has words. */
export const COURSE_REFUSALS: readonly string[] = ["proceeding_not_found", "not_tracked", "read_cooldown"];
