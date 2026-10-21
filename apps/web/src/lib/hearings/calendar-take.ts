import "server-only";

import { CALENDAR_DESCRIPTION, calendarNameOf } from "@/lib/calendar/provider";
import {
  CalendarAuthError,
  type CalendarGrant,
  CalendarPlatformError,
  type CalendarProvider,
  CalendarUnavailableError,
} from "@flyee/calendar/types";

/**
 * Which calendar of hearings a firm takes under a grant (migration 0037,
 * `@flyee/calendar`): the one it had, when the account may still write it
 * and it was not deleted in Google; a new one otherwise. Never a second
 * calendar on a guess: when the account could not be asked, nothing is made.
 *
 *   again   the one it had or a new one (the account was just connected);
 *   retake  the one it had only (a person asks to take it back);
 *   new     a new one (a person asks for a new calendar).
 */

/** The firm's calendar as the database keeps it, whatever its state. */
export type PreviousCalendar = { calendar_id: string; name: string; status: string; problem: string | null } | null;

export type Taken =
  | { ok: true; calendarId: string; name: string; reused: boolean }
  | {
      ok: false;
      code: "grant_refused" | "calendar_unavailable" | "calendar_refused" | "calendar_unusable" | "no_calendar";
    };

const failure = (thrown: unknown): Extract<Taken, { ok: false }>["code"] =>
  thrown instanceof CalendarAuthError
    ? "grant_refused"
    : thrown instanceof CalendarUnavailableError || thrown instanceof CalendarPlatformError
      ? "calendar_unavailable"
      : "calendar_refused";

/** A calendar that may be taken back: one the firm had that was not deleted in Google. */
export const takeable = (previous: PreviousCalendar): previous is NonNullable<PreviousCalendar> =>
  Boolean(previous?.calendar_id) && !(previous?.status === "lost" && previous.problem === "gone");

export async function takeCalendar(
  provider: CalendarProvider,
  grant: CalendarGrant,
  previous: PreviousCalendar,
  firmName: string,
  mode: "again" | "retake" | "new",
): Promise<Taken> {
  if (mode !== "new" && takeable(previous)) {
    let access: "writable" | "unusable";
    try {
      access = await provider.calendarAccess(grant, previous.calendar_id);
    } catch (thrown) {
      return { ok: false, code: failure(thrown) };
    }
    if (access === "writable") {
      return {
        ok: true,
        calendarId: previous.calendar_id,
        name: previous.name || calendarNameOf(firmName),
        reused: true,
      };
    }
    if (mode === "retake") return { ok: false, code: "calendar_unusable" };
  } else if (mode === "retake") {
    return { ok: false, code: "no_calendar" };
  }
  const name = calendarNameOf(firmName);
  try {
    const made = await provider.createCalendar(grant, {
      name,
      description: CALENDAR_DESCRIPTION,
      timeZone: "America/Sao_Paulo",
    });
    return { ok: true, calendarId: made.id, name, reused: false };
  } catch (thrown) {
    return { ok: false, code: failure(thrown) };
  }
}
