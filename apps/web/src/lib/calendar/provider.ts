import "server-only";

import { getVault } from "@/lib/connections/vault";
import { FakeCalendarProvider } from "@flyee/calendar/fake";
import { GoogleCalendarProvider } from "@flyee/calendar/providers/google";
import type { CalendarGrant, CalendarProvider } from "@flyee/calendar/types";
import { BRAND } from "@flyee/content";

/**
 * Who speaks for the firms' calendars of hearings. Google, with the
 * platform's OAuth client (`GOOGLE_OAUTH_CLIENT_ID` and
 * `GOOGLE_OAUTH_CLIENT_SECRET` in the server's environment); on a
 * development machine or a preview with `CALENDAR_FAKE=1`, a calendar in
 * memory that consents at once, never in production. Without either, the
 * card of the calendar says it is not available here and nothing is written
 * anywhere.
 */

/**
 * The fake kept for the process, on the global object so that every bundle
 * of the server shares it. It is lenient: on a preview the action that
 * connects and the job that writes may run in different instances, each with
 * its own memory, and each must take the grant and the calendar the other
 * made.
 */
const shared = globalThis as typeof globalThis & { __oneCalendarFake?: FakeCalendarProvider };

export function isCalendarFakeOn(): boolean {
  return process.env.CALENDAR_FAKE === "1" && process.env.VERCEL_ENV !== "production";
}

export function calendarProvider(): CalendarProvider | null {
  if (isCalendarFakeOn()) {
    shared.__oneCalendarFake ??= new FakeCalendarProvider({ lenient: true });
    return shared.__oneCalendarFake;
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? new GoogleCalendarProvider({ clientId, clientSecret }) : null;
}

/** Where Google sends a person back after the consent: the address the OAuth client names. */
export const calendarRedirectUri = (): string => `${BRAND.siteUrl.replace(/\/+$/, "")}/api/connections/google/callback`;

/** The connection's provider slug. */
export const CALENDAR_PROVIDER = "google_calendar";

/** The cookie that ties a consent's return to the person and the connection that started it. */
export const CALENDAR_STATE_COOKIE = "one-calendar-state";

/** What the calendar is called in the account, and what it says of itself. */
export const calendarNameOf = (firmName: string): string => `Audiências · ${firmName}`.slice(0, 120);
export const CALENDAR_DESCRIPTION = "As audiências do escritório, escritas pelo ONE.";

export type GrantAccess = { ok: true; grant: CalendarGrant } | { ok: false; code: string };

/** The firm's grant, opened from the vault for one piece of work, with the purpose recorded with the read. */
export async function calendarGrant(
  place: { orgId: string; connectionId: string },
  purpose: string,
): Promise<GrantAccess> {
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const opened = await access.vault.open(place, purpose);
  if (opened.kind !== "opened") return { ok: false, code: `vault_${opened.code}` };
  const refreshToken = opened.payload.refresh_token;
  return refreshToken ? { ok: true, grant: { refreshToken } } : { ok: false, code: "vault_token_missing" };
}
