import {
  CALENDAR_SCOPE,
  CalendarAuthError,
  type CalendarEvent,
  type CalendarGrant,
  type CalendarGrantGiven,
  CalendarGoneError,
  CalendarPlatformError,
  type CalendarProvider,
  CalendarQuotaError,
  CalendarUnavailableError,
} from "@flyee/calendar/types";

type FakeCalendar = { name: string; timeZone: string; events: Map<string, CalendarEvent>; removed: Set<string> };

const GRANT = /^fake-grant-/;
const CALENDAR = /^agenda-[a-z0-9-]+@group\.calendar\.invalid$/;

/**
 * A calendar provider in memory: the accounts' calendars and their events,
 * what each consent gave, and the failures a test asks for. Deterministic:
 * the calendars are numbered in the order they are made. What stands where
 * Google stands for the tests, and for a machine with no Google project.
 *
 * `lenient` is for a server that runs in more than one instance (a preview):
 * each instance has its own memory, so a grant and a calendar this fake made
 * are taken by any instance, by their form, unless that instance saw the
 * grant given back. What it "wrote" is not readable anywhere else.
 */
export class FakeCalendarProvider implements CalendarProvider {
  /** The calendars by id, each with its events by id and the ids taken out. */
  readonly calendars = new Map<string, FakeCalendar>();
  /** The grants that still hold, by refresh token. */
  readonly grants = new Set<string>();
  /** The grants given back, for a lenient fake. */
  private readonly revoked = new Set<string>();
  /** The next calls fail this way, in order. */
  readonly failures: ("unavailable" | "quota" | "platform" | "auth" | "gone")[] = [];
  /** Calendars shared with the account to be read only: `calendarAccess` says them unusable. */
  readonly readOnly = new Set<string>();
  private readonly lenient: boolean;
  private made = 0;
  private consents = 0;

  constructor(options: { lenient?: boolean } = {}) {
    this.lenient = options.lenient ?? false;
  }

  /** Consents at once: straight back to the redirect with a code, as a person who said yes would come back. */
  authorizationUrl(input: { state: string; redirectUri: string }): string {
    const back = new URL(input.redirectUri);
    back.searchParams.set("code", "consentiu");
    back.searchParams.set("state", input.state);
    back.searchParams.set("scope", CALENDAR_SCOPE);
    return back.toString();
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<CalendarGrantGiven> {
    // A code that says so stands for a person who unchecked the calendar's permission.
    if (input.code === "sem-agenda") throw new CalendarAuthError("scope_not_granted");
    this.consents += 1;
    const refreshToken = `fake-grant-${input.code}-${this.lenient ? `${Date.now().toString(36)}-` : ""}${this.consents}`;
    this.grants.add(refreshToken);
    return { refreshToken, scopes: [CALENDAR_SCOPE] };
  }

  private holds(grant: CalendarGrant): boolean {
    if (this.grants.has(grant.refreshToken)) return true;
    return this.lenient && GRANT.test(grant.refreshToken) && !this.revoked.has(grant.refreshToken);
  }

  private check(grant: CalendarGrant): void {
    const failure = this.failures.shift();
    if (failure === "unavailable") throw new CalendarUnavailableError("fake");
    if (failure === "quota") throw new CalendarQuotaError("dailyLimitExceeded");
    if (failure === "platform") throw new CalendarPlatformError("invalid_client");
    if (failure === "auth" || !this.holds(grant)) throw new CalendarAuthError("invalid_grant");
    if (failure === "gone") throw new CalendarGoneError();
  }

  /** A calendar by id; a lenient fake takes one of its own form that another instance made. */
  private calendar(id: string): FakeCalendar | undefined {
    const found = this.calendars.get(id);
    if (found || !this.lenient || !CALENDAR.test(id)) return found;
    const made: FakeCalendar = { name: "Audiências", timeZone: "America/Sao_Paulo", events: new Map(), removed: new Set() };
    this.calendars.set(id, made);
    return made;
  }

  async createCalendar(
    grant: CalendarGrant,
    input: { name: string; description: string; timeZone: string },
  ): Promise<{ id: string }> {
    this.check(grant);
    this.made += 1;
    const id = `agenda-${this.lenient ? `${Date.now().toString(36)}-` : ""}${this.made}@group.calendar.invalid`;
    this.calendars.set(id, { name: input.name, timeZone: input.timeZone, events: new Map(), removed: new Set() });
    return { id };
  }

  async calendarAccess(grant: CalendarGrant, calendarId: string): Promise<"writable" | "unusable"> {
    this.check(grant);
    if (this.readOnly.has(calendarId)) return "unusable";
    return this.calendar(calendarId) ? "writable" : "unusable";
  }

  async upsertEvent(grant: CalendarGrant, calendarId: string, event: CalendarEvent): Promise<"created" | "updated"> {
    this.check(grant);
    const calendar = this.calendar(calendarId);
    if (!calendar) throw new CalendarGoneError();
    // An event taken out and written again comes back, as Google brings it back.
    const existed = calendar.events.has(event.id) || calendar.removed.delete(event.id);
    calendar.events.set(event.id, { ...event });
    return existed ? "updated" : "created";
  }

  async deleteEvent(grant: CalendarGrant, calendarId: string, eventId: string): Promise<"deleted" | "absent"> {
    this.check(grant);
    const calendar = this.calendar(calendarId);
    if (!calendar?.events.delete(eventId)) return "absent";
    calendar.removed.add(eventId);
    return "deleted";
  }

  async revoke(grant: CalendarGrant): Promise<void> {
    this.grants.delete(grant.refreshToken);
    this.revoked.add(grant.refreshToken);
  }
}
