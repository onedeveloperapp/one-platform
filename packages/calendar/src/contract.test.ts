import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventIdOf } from "./event-id.ts";
import { FakeCalendarProvider } from "./fake.ts";
import { GoogleCalendarProvider } from "./providers/google.ts";
import {
  CALENDAR_SCOPE,
  CalendarAuthError,
  type CalendarEvent,
  CalendarGoneError,
  CalendarPlatformError,
  type CalendarProvider,
  CalendarQuotaError,
  CalendarRequestError,
  CalendarUnavailableError,
} from "./types.ts";

/**
 * What any calendar provider does, run against the fake and against the
 * Google provider talking to a stand-in that answers in the shapes of
 * Google's references (read on 2026-10-11): the token endpoint, calendars,
 * the calendar list, events, and the errors of the Calendar API. An event
 * taken out is kept by the stand-in as Google keeps it: written again by its
 * id it comes back, and created again by the same id it is refused (409).
 * Every hearing here is invented.
 */

const REDIRECT = "https://app.one.invalid/api/connections/google/callback";

const hearing = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: eventIdOf("5a1c0b7e-3d2f-4e8a-9b6c-0123456789ab"),
  summary: "Audiência de conciliação · Caso 12",
  description: "Processo 5000123-60.2099.8.09.0051 · TJGO",
  location: "https://videoconferencia.invalid/sala-1",
  start: "2026-11-10T17:00:00.000Z",
  end: "2026-11-10T18:00:00.000Z",
  timeZone: "America/Sao_Paulo",
  sourceUrl: "https://app.one.invalid/casos/1",
  ...overrides,
});

// ---------- A stand-in for Google, on its documented shapes ----------

type Call = { method: string; url: URL; headers: Record<string, string>; body: string | null };

function googleStandIn() {
  const calendars = new Map<string, Map<string, Record<string, unknown>>>();
  /** Events taken out, by calendar and id: Google keeps them, cancelled. */
  const deleted = new Set<string>();
  /** Calendars shared with the account to be read only. */
  const readOnly = new Set<string>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  const usedCodes = new Set<string>();
  const calls: Call[] = [];
  /** The next calls of the Calendar API answer this, in order. */
  const injected: { status: number; body: unknown }[] = [];
  /** The token endpoint refuses the platform's client from now on (a wrong or rotated secret). */
  let clientRefused = false;
  let tokens = 0;
  let made = 0;

  const json = (status: number, body: unknown) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const apiError = (status: number, reason: string, message: string) =>
    json(status, { error: { code: status, message, errors: [{ domain: "global", reason, message }] } });

  const run = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, url, headers, body });

    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(body ?? "");
      if (clientRefused) return json(401, { error: "invalid_client", error_description: "The OAuth client was not found." });
      if (form.get("grant_type") === "authorization_code") {
        const code = form.get("code") ?? "";
        if (usedCodes.has(code) || form.get("redirect_uri") !== REDIRECT) return json(400, { error: "invalid_grant" });
        usedCodes.add(code);
        tokens += 1;
        const access = `ya29.acesso-${tokens}`;
        accessTokens.add(access);
        // A person who unchecked the calendar's permission gives a token of nothing.
        if (code === "sem-agenda") return json(200, { access_token: access, expires_in: 3599, scope: "openid", token_type: "Bearer" });
        const refresh = `1//grant-${tokens}`;
        refreshTokens.add(refresh);
        return json(200, { access_token: access, expires_in: 3599, refresh_token: refresh, scope: CALENDAR_SCOPE, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (!refreshTokens.has(form.get("refresh_token") ?? "")) {
          return json(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        }
        tokens += 1;
        const access = `ya29.acesso-${tokens}`;
        accessTokens.add(access);
        return json(200, { access_token: access, expires_in: 3599, scope: CALENDAR_SCOPE, token_type: "Bearer" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (url.href === "https://oauth2.googleapis.com/revoke") {
      const token = new URLSearchParams(body ?? "").get("token") ?? "";
      if (!refreshTokens.delete(token)) return json(400, { error: "invalid_token" });
      return json(200, {});
    }

    const injectedAnswer = injected.shift();
    if (injectedAnswer) return json(injectedAnswer.status, injectedAnswer.body);
    const bearer = (headers.Authorization ?? "").replace(/^Bearer /, "");
    if (!accessTokens.has(bearer)) return apiError(401, "authError", "Invalid Credentials");

    const path = url.pathname.replace(/^\/calendar\/v3/, "");
    const listed = /^\/users\/me\/calendarList\/([^/]+)$/.exec(path);
    if (method === "GET" && listed) {
      const id = decodeURIComponent(listed[1]);
      if (!calendars.has(id)) return apiError(404, "notFound", "Not Found");
      return json(200, { kind: "calendar#calendarListEntry", id, accessRole: readOnly.has(id) ? "reader" : "owner" });
    }
    if (method === "POST" && path === "/calendars") {
      const asked = JSON.parse(body ?? "{}") as Record<string, unknown>;
      made += 1;
      const id = `c_${made}@group.calendar.google.com`;
      calendars.set(id, new Map());
      return json(200, { kind: "calendar#calendar", id, summary: asked.summary, timeZone: asked.timeZone });
    }
    const match = /^\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (!match) return apiError(404, "notFound", "Not Found");
    const calendarId = decodeURIComponent(match[1]);
    const events = calendars.get(calendarId);
    if (!events) return apiError(404, "notFound", "Not Found");
    const eventId = match[2];
    const kept = (id: string) => deleted.has(`${calendarId}/${id}`);
    if (method === "PUT" && eventId) {
      if (!events.has(eventId) && !kept(eventId)) return apiError(404, "notFound", "Not Found");
      // One taken out comes back with the status it is written with.
      deleted.delete(`${calendarId}/${eventId}`);
      const replaced = { ...(JSON.parse(body ?? "{}") as Record<string, unknown>), id: eventId };
      events.set(eventId, replaced);
      return json(200, replaced);
    }
    if (method === "POST" && !eventId) {
      const created = JSON.parse(body ?? "{}") as Record<string, unknown>;
      const id = String(created.id);
      if (events.has(id) || kept(id)) return apiError(409, "duplicate", "The requested identifier already exists.");
      events.set(id, created);
      return json(200, created);
    }
    if (method === "DELETE" && eventId) {
      if (!events.has(eventId)) {
        return kept(eventId) ? apiError(410, "deleted", "Resource has been deleted") : apiError(404, "notFound", "Not Found");
      }
      events.delete(eventId);
      deleted.add(`${calendarId}/${eventId}`);
      return new Response(null, { status: 204 });
    }
    return apiError(400, "badRequest", "Bad Request");
  }) as typeof fetch;

  return {
    run,
    calls,
    calendars,
    injected,
    /** Ends every access token in hand, as an hour passing would. */
    expireAccessTokens: () => accessTokens.clear(),
    /** Revokes a grant, as the account's owner would in its permissions. */
    revokeGrant: (refreshToken: string) => refreshTokens.delete(refreshToken),
    /** Deletes a calendar, as somebody would in Google. */
    deleteCalendar: (id: string) => calendars.delete(id),
    /** Leaves a calendar in the account only to be read, as one shared "see all event details" is. */
    shareReadOnly: (id: string) => readOnly.add(id),
    /** The platform's client secret is wrong from now on. */
    refuseClient: () => {
      clientRefused = true;
    },
  };
}

// ---------- The contract ----------

type Harness = {
  provider: CalendarProvider;
  consentCode: string;
  /** The events of a calendar, by id, as the provider's side holds them. */
  eventsOf: (calendarId: string) => Map<string, unknown> | undefined;
  revoke: (refreshToken: string) => void;
  deleteCalendar: (calendarId: string) => void;
  shareReadOnly: (calendarId: string) => void;
  failNext: () => void;
};

function contract(name: string, make: () => Harness) {
  describe(`${name}: the contract of a calendar provider`, () => {
    it("gives a grant for a consent with the calendar's scope, and refuses one without it", async () => {
      const { provider, consentCode } = make();
      const given = await provider.exchangeCode({ code: consentCode, redirectUri: REDIRECT });
      assert.ok(given.refreshToken.length > 0);
      assert.ok(given.scopes.includes(CALENDAR_SCOPE));
      await assert.rejects(provider.exchangeCode({ code: "sem-agenda", redirectUri: REDIRECT }), CalendarAuthError);
    });

    it("creates the firm's calendar and writes a hearing by its id: created, then replaced, then taken out", async () => {
      const { provider, consentCode, eventsOf } = make();
      const grant = { refreshToken: (await provider.exchangeCode({ code: consentCode, redirectUri: REDIRECT })).refreshToken };
      const calendar = await provider.createCalendar(grant, {
        name: "Audiências · Souza Advogados",
        description: "As audiências do escritório.",
        timeZone: "America/Sao_Paulo",
      });
      assert.ok(calendar.id.length > 0);
      assert.equal(await provider.upsertEvent(grant, calendar.id, hearing()), "created");
      assert.equal(await provider.upsertEvent(grant, calendar.id, hearing({ start: "2026-11-11T09:00:00-03:00" })), "updated");
      assert.equal(eventsOf(calendar.id)?.size, 1);
      assert.equal(await provider.deleteEvent(grant, calendar.id, hearing().id), "deleted");
      assert.equal(await provider.deleteEvent(grant, calendar.id, hearing().id), "absent");
      assert.equal(eventsOf(calendar.id)?.size, 0);
      // Written again by its id after it was taken out (a hearing cancelled and put back), it comes back.
      assert.ok(["created", "updated"].includes(await provider.upsertEvent(grant, calendar.id, hearing())));
      assert.equal(eventsOf(calendar.id)?.size, 1);
    });

    it("says whether the account may still write a calendar: its own, one deleted, one it may only read", async () => {
      const { provider, consentCode, deleteCalendar, shareReadOnly } = make();
      const grant = { refreshToken: (await provider.exchangeCode({ code: consentCode, redirectUri: REDIRECT })).refreshToken };
      const own = await provider.createCalendar(grant, { name: "Audiências", description: "", timeZone: "America/Sao_Paulo" });
      assert.equal(await provider.calendarAccess(grant, own.id), "writable");
      const shared = await provider.createCalendar(grant, { name: "De outra conta", description: "", timeZone: "America/Sao_Paulo" });
      shareReadOnly(shared.id);
      assert.equal(await provider.calendarAccess(grant, shared.id), "unusable");
      deleteCalendar(own.id);
      assert.equal(await provider.calendarAccess(grant, own.id), "unusable");
    });

    it("says when the calendar is gone, when the grant no longer holds, and when the provider does not answer", async () => {
      const { provider, consentCode, revoke, deleteCalendar, failNext } = make();
      const grant = { refreshToken: (await provider.exchangeCode({ code: consentCode, redirectUri: REDIRECT })).refreshToken };
      const calendar = await provider.createCalendar(grant, { name: "Audiências", description: "", timeZone: "America/Manaus" });
      failNext();
      await assert.rejects(provider.upsertEvent(grant, calendar.id, hearing()), CalendarUnavailableError);
      deleteCalendar(calendar.id);
      await assert.rejects(provider.upsertEvent(grant, calendar.id, hearing()), CalendarGoneError);
      revoke(grant.refreshToken);
      await assert.rejects(provider.createCalendar(grant, { name: "Outra", description: "", timeZone: "America/Sao_Paulo" }), CalendarAuthError);
    });
  });
}

contract("the fake", () => {
  const provider = new FakeCalendarProvider();
  return {
    provider,
    consentCode: "consentiu",
    eventsOf: (id) => provider.calendars.get(id)?.events,
    revoke: (token) => provider.grants.delete(token),
    deleteCalendar: (id) => provider.calendars.delete(id),
    shareReadOnly: (id) => provider.readOnly.add(id),
    failNext: () => provider.failures.push("unavailable"),
  };
});

contract("Google", () => {
  const google = googleStandIn();
  const provider = new GoogleCalendarProvider({ clientId: "cliente.apps.googleusercontent.com", clientSecret: "segredo-de-teste", fetch: google.run });
  return {
    provider,
    consentCode: "consentiu",
    eventsOf: (id) => google.calendars.get(id),
    revoke: (token) => {
      google.revokeGrant(token);
      google.expireAccessTokens();
    },
    deleteCalendar: (id) => google.deleteCalendar(id),
    shareReadOnly: (id) => google.shareReadOnly(id),
    failNext: () => google.injected.push({ status: 503, body: { error: { code: 503, message: "Backend Error" } } }),
  };
});

// ---------- What only Google's provider does ----------

describe("Google: what the provider sends", () => {
  it("asks for the one scope, offline, with the account chosen and the consent asked again, and the state kept", () => {
    const provider = new GoogleCalendarProvider({ clientId: "cliente.apps.googleusercontent.com", clientSecret: "x" });
    const url = new URL(provider.authorizationUrl({ state: "estado-123", redirectUri: REDIRECT }));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("scope"), CALENDAR_SCOPE);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent select_account");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), "estado-123");
    assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
  });

  it("asks a new access token once when the one in hand ended, and sends no event to anybody", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    const calendar = await provider.createCalendar(grant, { name: "Audiências", description: "", timeZone: "America/Sao_Paulo" });
    google.expireAccessTokens();
    assert.equal(await provider.upsertEvent(grant, calendar.id, hearing()), "created");
    const refreshes = google.calls.filter((call) => call.url.href === "https://oauth2.googleapis.com/token");
    assert.equal(refreshes.length, 2);
    const eventCalls = google.calls.filter((call) => call.url.pathname.includes("/events"));
    assert.ok(eventCalls.length > 0 && eventCalls.every((call) => call.url.searchParams.get("sendUpdates") === "none"));
    const written = google.calendars.get(calendar.id)?.get(hearing().id) as Record<string, unknown>;
    assert.deepEqual(written.start, { dateTime: "2026-11-10T17:00:00.000Z", timeZone: "America/Sao_Paulo" });
    assert.equal(written.status, "confirmed");
    assert.deepEqual(written.source, { title: "ONE", url: "https://app.one.invalid/casos/1" });
    assert.equal(written.attendees, undefined);
  });

  it("tells a limit of the API from a refusal, and a code used twice from a good one", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    await assert.rejects(provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT }), CalendarAuthError);
    google.injected.push({
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }] } },
    });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarUnavailableError);
    google.injected.push({
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "insufficientPermissions", message: "Insufficient Permission" }] } },
    });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarAuthError);
    google.injected.push({ status: 429, body: { error: { code: 429 } } });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarUnavailableError);
    // A limit said in the new form of Google's errors, with no `errors[]`, is a limit too.
    google.injected.push({ status: 403, body: { error: { code: 403, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } } });
    await assert.rejects(
      provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }),
      (thrown: unknown) => thrown instanceof CalendarUnavailableError && !(thrown instanceof CalendarQuotaError),
    );
    // The platform's project out of its day is told apart: every firm waits, and no hearing spends its attempts.
    google.injected.push({
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "dailyLimitExceeded", message: "Daily Limit Exceeded" }] } },
    });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarQuotaError);
  });

  it("tells what is the platform's own (its client refused, the API off) from a firm's grant that ended", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    google.injected.push({
      status: 403,
      body: { error: { code: 403, errors: [{ reason: "accessNotConfigured", message: "Access Not Configured." }] } },
    });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarPlatformError);
    google.injected.push({
      status: 403,
      body: { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } },
    });
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarPlatformError);
    // The secret rotated: the next access token is refused for the platform's client, not for the firm's grant.
    google.refuseClient();
    google.expireAccessTokens();
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), (thrown: unknown) =>
      thrown instanceof CalendarPlatformError && !(thrown instanceof CalendarAuthError));
    await assert.rejects(provider.exchangeCode({ code: "outro", redirectUri: REDIRECT }), CalendarPlatformError);
  });

  it("brings back by its id an event taken out, which Google keeps and refuses to create again", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    const calendar = await provider.createCalendar(grant, { name: "Audiências", description: "", timeZone: "America/Sao_Paulo" });
    await provider.upsertEvent(grant, calendar.id, hearing());
    await provider.deleteEvent(grant, calendar.id, hearing().id);
    assert.equal(await provider.upsertEvent(grant, calendar.id, hearing()), "updated");
    const posts = google.calls.filter((call) => call.method === "POST" && call.url.pathname.endsWith("/events"));
    assert.equal(posts.length, 1);
  });

  it("tells an event that cannot be written from a calendar that is gone, by asking for the calendar", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    const calendar = await provider.createCalendar(grant, { name: "Audiências", description: "", timeZone: "America/Sao_Paulo" });
    const notFound = { status: 404, body: { error: { code: 404, errors: [{ reason: "notFound" }] } } };
    google.injected.push(notFound, { status: 409, body: { error: { code: 409, errors: [{ reason: "duplicate" }] } } }, notFound);
    await assert.rejects(
      provider.upsertEvent(grant, calendar.id, hearing()),
      (thrown: unknown) => thrown instanceof CalendarRequestError && thrown.code === "event_unavailable",
    );
    google.deleteCalendar(calendar.id);
    await assert.rejects(provider.upsertEvent(grant, calendar.id, hearing()), CalendarGoneError);
  });

  it("gives the grant back when the firm disconnects", async () => {
    const google = googleStandIn();
    const provider = new GoogleCalendarProvider({ clientId: "c", clientSecret: "s", fetch: google.run });
    const grant = { refreshToken: (await provider.exchangeCode({ code: "consentiu", redirectUri: REDIRECT })).refreshToken };
    await provider.revoke(grant);
    google.expireAccessTokens();
    await assert.rejects(provider.createCalendar(grant, { name: "A", description: "", timeZone: "America/Sao_Paulo" }), CalendarAuthError);
    // A grant already given back is no error.
    await provider.revoke(grant);
  });
});
