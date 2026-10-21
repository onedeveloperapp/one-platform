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
  CalendarRequestError,
  CalendarUnavailableError,
} from "@flyee/calendar/types";

/**
 * Google Calendar, written from Google's references (read on 2026-10-11):
 * OAuth 2.0 for web server applications, the scopes of the Calendar API,
 * calendars.insert, calendarList.get, events.insert, events.update,
 * events.delete and the errors of the Calendar API.
 *
 *   GET  https://accounts.google.com/o/oauth2/v2/auth   client_id, redirect_uri, response_type=code,
 *        scope, access_type=offline, prompt="consent select_account", state
 *   POST https://oauth2.googleapis.com/token            grant_type=authorization_code | refresh_token
 *        -> { access_token, expires_in, refresh_token (offline, first consent or prompt=consent), scope }
 *   POST https://oauth2.googleapis.com/revoke           token
 *   POST https://www.googleapis.com/calendar/v3/calendars                      -> { id, summary, timeZone }
 *   GET  .../users/me/calendarList/{calendarId}         -> { accessRole: owner | writer | reader | freeBusyReader }
 *   PUT  .../calendars/{calendarId}/events/{eventId}    replaces an event, and brings back one taken out
 *   POST .../calendars/{calendarId}/events              creates one with the id given; 409 when the id exists
 *   DELETE .../calendars/{calendarId}/events/{eventId}  204; 410 when it was deleted already
 *
 * What the errors mean here: 401 is an access token that ended (a new one is
 * asked with the refresh token, once); `invalid_grant` on a refresh is a
 * grant that no longer holds (revoked, unused for six months, or, while the
 * project's consent screen is in Testing, older than seven days); 403 with a
 * reason of rate or quota (in the old `errors[]`, in the `details[]` of the
 * new form, or as the status `RESOURCE_EXHAUSTED`) and 429 and 5xx pass with
 * time, while `dailyLimitExceeded` is the platform's project out of its day
 * for every firm at once; any other 403 is a refusal of the account. What is
 * the platform's own and no firm's is told apart too: the token endpoint
 * refusing the client (`invalid_client`, `unauthorized_client`,
 * `deleted_client`: a wrong or rotated secret) and the API off in the
 * project (`accessNotConfigured`, `SERVICE_DISABLED`). A 404 on an event is
 * told apart by asking for the calendar itself: when the account no longer
 * has the calendar, it was deleted. No event is ever sent to anybody:
 * `sendUpdates=none`, and an event of a hearing has no guests.
 *
 * The consent carries no PKCE: the reference for web server applications
 * names no such parameter, and the code is worth nothing without the
 * client's secret, which never leaves the server.
 */

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/** The reasons of a 403 that are a limit of an account or a calendar, not a refusal. */
const LIMIT_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "RATE_LIMIT_EXCEEDED",
  "RESOURCE_EXHAUSTED",
]);
/** The reasons of a 403 that are the platform's project out of its day: every firm at once. */
const PROJECT_REASONS = new Set(["dailyLimitExceeded"]);
/** The reasons of a 403 that are the API off in the platform's project: every firm at once. */
const DISABLED_REASONS = new Set(["accessNotConfigured", "SERVICE_DISABLED"]);
/** What the token endpoint says of the platform's own client (a wrong or rotated secret): every firm at once. */
const CLIENT_ERRORS = new Set(["invalid_client", "unauthorized_client", "deleted_client"]);

export type GoogleCalendarConfig = {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Injected in tests. */
  now?: () => number;
};

type Answer = { status: number; body: Record<string, unknown> | null };

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

/** Every reason Google gives a refusal: `error.errors[].reason`, `error.details[].reason`, and `error.status`. */
function reasonsOf(body: Record<string, unknown> | null): string[] {
  const error = record(body?.error);
  const listed = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap((item) => {
          const reason = record(item)?.reason;
          return typeof reason === "string" ? [reason] : [];
        })
      : [];
  const status = typeof error?.status === "string" ? [error.status] : [];
  return [...listed(error?.errors), ...listed(error?.details), ...status];
}

/** The first reason, for a code. */
const reasonOf = (body: Record<string, unknown> | null): string => reasonsOf(body)[0] ?? "";

export class GoogleCalendarProvider implements CalendarProvider {
  private readonly config: GoogleCalendarConfig;
  /** Access tokens by refresh token, asked again a minute before they end. */
  private readonly tokens = new Map<string, { value: string; until: number }>();

  constructor(config: GoogleCalendarConfig) {
    this.config = config;
  }

  private now(): number {
    return this.config.now ? this.config.now() : Date.now();
  }

  private async call(url: string, init: RequestInit): Promise<Answer> {
    const run = this.config.fetch ?? fetch;
    let response: Response;
    try {
      response = await run(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000) });
    } catch {
      throw new CalendarUnavailableError("no_answer");
    }
    const text = await response.text().catch(() => "");
    let body: Record<string, unknown> | null = null;
    try {
      body = text ? record(JSON.parse(text)) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  private form(fields: Record<string, string>): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    };
  }

  authorizationUrl(input: { state: string; redirectUri: string }): string {
    const query = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: CALENDAR_SCOPE,
      // A grant the backend can use with nobody present, asked again each time so it always comes back, of the
      // account the person picks rather than whichever is signed in.
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "false",
      state: input.state,
    });
    return `${AUTHORIZE}?${query.toString()}`;
  }

  async exchangeCode(input: { code: string; redirectUri: string }): Promise<CalendarGrantGiven> {
    const answer = await this.call(
      TOKEN,
      this.form({
        code: input.code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }),
    );
    if (answer.status >= 500) throw new CalendarUnavailableError(`status_${answer.status}`);
    const refusal = String(answer.body?.error ?? "");
    if (CLIENT_ERRORS.has(refusal)) throw new CalendarPlatformError(refusal);
    if (answer.status !== 200 || !answer.body) {
      // A code used twice or too late, a redirect that differs: the person consents again.
      throw new CalendarAuthError(refusal || `status_${answer.status}`);
    }
    const scopes = String(answer.body.scope ?? "")
      .split(/\s+/)
      .filter(Boolean);
    if (!scopes.includes(CALENDAR_SCOPE)) throw new CalendarAuthError("scope_not_granted");
    const refreshToken = typeof answer.body.refresh_token === "string" ? answer.body.refresh_token : "";
    if (!refreshToken) throw new CalendarAuthError("no_refresh_token");
    const accessToken = typeof answer.body.access_token === "string" ? answer.body.access_token : "";
    if (accessToken) {
      const seconds = Number(answer.body.expires_in);
      this.tokens.set(refreshToken, {
        value: accessToken,
        until: this.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000 - 60_000,
      });
    }
    return { refreshToken, scopes };
  }

  /** The access token of a grant: the one in hand while it lasts, a new one otherwise. */
  private async bearer(grant: CalendarGrant, force = false): Promise<string> {
    const known = this.tokens.get(grant.refreshToken);
    if (!force && known && known.until > this.now()) return known.value;
    const answer = await this.call(
      TOKEN,
      this.form({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: grant.refreshToken,
        grant_type: "refresh_token",
      }),
    );
    if (answer.status >= 500 || answer.status === 429) throw new CalendarUnavailableError(`status_${answer.status}`);
    const accessToken = typeof answer.body?.access_token === "string" ? answer.body.access_token : "";
    if (answer.status !== 200 || !accessToken) {
      const refusal = String(answer.body?.error ?? "");
      // The platform's client refused: no firm's grant is at fault.
      if (CLIENT_ERRORS.has(refusal)) throw new CalendarPlatformError(refusal);
      this.tokens.delete(grant.refreshToken);
      throw new CalendarAuthError(refusal || `status_${answer.status}`);
    }
    const seconds = Number(answer.body?.expires_in);
    this.tokens.set(grant.refreshToken, {
      value: accessToken,
      until: this.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000 - 60_000,
    });
    return accessToken;
  }

  /** A call of the Calendar API under the grant: an ended access token is asked again once. */
  private async api(grant: CalendarGrant, method: string, path: string, body?: unknown): Promise<Answer> {
    const send = async (token: string) =>
      this.call(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    let answer = await send(await this.bearer(grant));
    if (answer.status === 401) answer = await send(await this.bearer(grant, true));
    if (answer.status === 401) throw new CalendarAuthError("invalid_credentials");
    if (answer.status === 429 || answer.status >= 500) throw new CalendarUnavailableError(`status_${answer.status}`);
    if (answer.status === 403) {
      const reasons = reasonsOf(answer.body);
      const project = reasons.find((reason) => PROJECT_REASONS.has(reason));
      if (project) throw new CalendarQuotaError(project);
      const disabled = reasons.find((reason) => DISABLED_REASONS.has(reason));
      if (disabled) throw new CalendarPlatformError(disabled);
      const limit = reasons.find((reason) => LIMIT_REASONS.has(reason));
      if (limit) throw new CalendarUnavailableError(limit);
      throw new CalendarAuthError(reasons[0] || "forbidden");
    }
    return answer;
  }

  async createCalendar(
    grant: CalendarGrant,
    input: { name: string; description: string; timeZone: string },
  ): Promise<{ id: string }> {
    const answer = await this.api(grant, "POST", "/calendars", {
      summary: input.name,
      description: input.description,
      timeZone: input.timeZone,
    });
    const id = typeof answer.body?.id === "string" ? answer.body.id : "";
    if (answer.status !== 200 || !id) throw new CalendarRequestError(reasonOf(answer.body) || `status_${answer.status}`);
    return { id };
  }

  async calendarAccess(grant: CalendarGrant, calendarId: string): Promise<"writable" | "unusable"> {
    const answer = await this.api(grant, "GET", `/users/me/calendarList/${encodeURIComponent(calendarId)}`);
    if (answer.status === 404 || answer.status === 410) return "unusable";
    if (answer.status !== 200) throw new CalendarRequestError(reasonOf(answer.body) || `status_${answer.status}`);
    const role = answer.body?.accessRole;
    return role === "owner" || role === "writer" ? "writable" : "unusable";
  }

  private eventBody(event: CalendarEvent): Record<string, unknown> {
    return {
      summary: event.summary,
      description: event.description,
      location: event.location ?? undefined,
      start: { dateTime: event.start, timeZone: event.timeZone },
      end: { dateTime: event.end, timeZone: event.timeZone },
      // An event taken out and written again comes back.
      status: "confirmed",
      transparency: "opaque",
      reminders: { useDefault: true },
      ...(event.sourceUrl ? { source: { title: "ONE", url: event.sourceUrl } } : {}),
    };
  }

  async upsertEvent(grant: CalendarGrant, calendarId: string, event: CalendarEvent): Promise<"created" | "updated"> {
    const events = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const replace = () => this.api(grant, "PUT", `${events}/${event.id}?sendUpdates=none`, this.eventBody(event));
    let answer = await replace();
    if (answer.status === 200) return "updated";
    if (answer.status === 404 || answer.status === 410) {
      answer = await this.api(grant, "POST", `${events}?sendUpdates=none`, { id: event.id, ...this.eventBody(event) });
      if (answer.status === 200 || answer.status === 201) return "created";
      // Written by another worker in between, or kept by Google after it was taken out: it is replaced.
      if (answer.status === 409) {
        answer = await replace();
        if (answer.status === 200) return "updated";
      }
    }
    if (answer.status === 404 || answer.status === 410) {
      // The calendar itself is asked: gone from the account, or there and this event cannot be written.
      if ((await this.calendarAccess(grant, calendarId)) === "unusable") throw new CalendarGoneError();
      throw new CalendarRequestError("event_unavailable");
    }
    throw new CalendarRequestError(reasonOf(answer.body) || `status_${answer.status}`);
  }

  async deleteEvent(grant: CalendarGrant, calendarId: string, eventId: string): Promise<"deleted" | "absent"> {
    const answer = await this.api(
      grant,
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}?sendUpdates=none`,
    );
    if (answer.status === 204 || answer.status === 200) return "deleted";
    if (answer.status === 404 || answer.status === 410) return "absent";
    throw new CalendarRequestError(reasonOf(answer.body) || `status_${answer.status}`);
  }

  async revoke(grant: CalendarGrant): Promise<void> {
    this.tokens.delete(grant.refreshToken);
    // A grant already gone answers 400: either way the account no longer lets ONE in.
    await this.call(REVOKE, this.form({ token: grant.refreshToken })).catch(() => undefined);
  }
}
