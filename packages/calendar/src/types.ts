/**
 * A firm's calendar of hearings (docs/ONE-PLANO-DESENVOLVIMENTO.md, 6: "Agenda
 * (Google): upsertEvent na agenda criada pelo ONE"). A person of the firm
 * connects a Google account; ONE creates in it one secondary calendar of the
 * firm's hearings and writes each hearing there as an event under an id of
 * its own (`eventIdOf`), so the same hearing written again replaces its
 * event and a cancelled one is taken out. ONE asks for the one scope that
 * makes secondary calendars and touches only the events in them
 * (`calendar.app.created`): it never reads the account's other calendars.
 *
 * The grant is the firm's: its refresh token is sealed in the vault, opened
 * by the backend for each piece of work, and never written to a log.
 */

/** The one scope ONE asks of the account: "Make secondary Google calendars, and see, create, change, and delete events on them". */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

/** A hearing as an event of the calendar: what the firm's people read in it. */
export type CalendarEvent = {
  /** The event's own id, chosen by ONE (`eventIdOf`): writing it again replaces it. */
  id: string;
  summary: string;
  description: string;
  /** The address, or the videoconference's link, when there is one. */
  location: string | null;
  /** When it starts and ends: moments in ISO 8601 (`2026-11-10T17:00:00.000Z`), read in `timeZone`. */
  start: string;
  end: string;
  /** The zone it is read in: the hearing's (`America/Manaus`). */
  timeZone: string;
  /** Where the hearing is kept: the address of its case in ONE. */
  sourceUrl: string | null;
};

/** What a person's consent gave: the grant ONE keeps, and the scopes it covers. */
export type CalendarGrantGiven = { refreshToken: string; scopes: string[] };

/** The grant a piece of work acts under: the refresh token, opened from the vault. */
export type CalendarGrant = { refreshToken: string };

/** The grant no longer holds (revoked, expired, a scope taken back): the firm connects the account again. */
export class CalendarAuthError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`calendar access refused: ${code}`);
    this.name = "CalendarAuthError";
    this.code = code;
  }
}

/** The calendar is no longer there, or no longer the account's: somebody deleted it in Google. */
export class CalendarGoneError extends Error {
  constructor() {
    super("the calendar is no longer there");
    this.name = "CalendarGoneError";
  }
}

/** No answer, a limit of the provider, an outage: the same request may go through later. */
export class CalendarUnavailableError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`calendar unavailable: ${code}`);
    this.name = "CalendarUnavailableError";
    this.code = code;
  }
}

/**
 * The platform's own side refused the work, for every firm at once: its
 * client was refused by the provider (a wrong or rotated secret), the API is
 * off in its project, or the project is out of its day. Never a firm's
 * grant: a worker stops, gives back what it took and stops nothing of any
 * firm, and once the platform's side is right again everything goes on.
 */
export class CalendarPlatformError extends CalendarUnavailableError {
  constructor(code: string) {
    super(code);
    this.name = "CalendarPlatformError";
  }
}

/** The platform's project used up what the provider gives it for the day: it renews by itself. */
export class CalendarQuotaError extends CalendarPlatformError {
  constructor(code: string) {
    super(code);
    this.name = "CalendarQuotaError";
  }
}

/** The provider refused what was sent (a field it does not take): sending it again changes nothing. */
export class CalendarRequestError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`calendar request refused: ${code}`);
    this.name = "CalendarRequestError";
    this.code = code;
  }
}

export interface CalendarProvider {
  /**
   * Where a person is sent to consent: the one scope, offline, the account chosen and the consent asked again
   * each time, so a grant always comes back and is of the account the person meant.
   */
  authorizationUrl(input: { state: string; redirectUri: string }): string;
  /** The grant of a consent's code. CalendarAuthError when the scope was not granted. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<CalendarGrantGiven>;
  /** Creates the firm's calendar in the account; its id. */
  createCalendar(grant: CalendarGrant, input: { name: string; description: string; timeZone: string }): Promise<{ id: string }>;
  /**
   * Whether the account of the grant may write a calendar: `writable` when it is the account's own or shared
   * with it to make changes; `unusable` when it is not in the account's list (deleted, never shared) or only to
   * be read. What decides, when an account connects again, between the firm's calendar and a new one.
   */
  calendarAccess(grant: CalendarGrant, calendarId: string): Promise<"writable" | "unusable">;
  /** Writes an event by its id: created when the calendar did not have it, replaced (or brought back) when it did. */
  upsertEvent(grant: CalendarGrant, calendarId: string, event: CalendarEvent): Promise<"created" | "updated">;
  /** Takes an event out; `absent` when it was not there (already taken out, or never written). */
  deleteEvent(grant: CalendarGrant, calendarId: string, eventId: string): Promise<"deleted" | "absent">;
  /** Gives the grant back to the account: what a disconnection does before the token is discarded. */
  revoke(grant: CalendarGrant): Promise<void>;
}
