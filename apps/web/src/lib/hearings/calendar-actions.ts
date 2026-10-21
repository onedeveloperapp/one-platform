"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";

import {
  CALENDAR_PROVIDER,
  CALENDAR_STATE_COOKIE,
  calendarGrant,
  calendarProvider,
  calendarRedirectUri,
} from "@/lib/calendar/provider";
import { getVault } from "@/lib/connections/vault";
import { isManager } from "@/lib/firm/roles";
import { type PreviousCalendar, takeCalendar } from "@/lib/hearings/calendar-take";
import { settleCalendarSync } from "@/lib/hearings/calendar-work";
import { getMemberContext } from "@/lib/member/context";
import { connectionRefusal } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";

/**
 * The firm's calendar of hearings in Google, for who manages the firm
 * (migration 0037, `@flyee/calendar`): start the consent (the person goes to
 * Google and comes back to `/api/connections/google/callback`, which keeps
 * the grant and takes the calendar), take back the calendar the firm had
 * under the grant in hand (when connecting again could not), make a new one
 * (the one in use was deleted in Google, or the account cannot write it), and
 * cut it (the grant given back to Google, then discarded). A grant Google no
 * longer honours is said to the firm as the worker would say it. Never a
 * support visit, and with the second factor.
 */

export type CalendarActionResult = { ok: true; code: string; url?: string } | { ok: false; code: string };

type ConnectionRow = { id: string; status: string };

async function currentConnection(): Promise<
  | { ok: true; firm: { id: string; name: string }; connection: ConnectionRow | null; userId: string }
  | { ok: false; code: string }
> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const { data } = await context.supabase
    .from("connections")
    .select("id, status")
    .eq("org_id", context.firm.id)
    .eq("provider", CALENDAR_PROVIDER)
    .neq("status", "disconnected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    ok: true,
    firm: { id: context.firm.id, name: context.firm.name },
    connection: (data as ConnectionRow | null) ?? null,
    userId: context.userId,
  };
}

/** Starts the consent: the address of Google's page the person goes to. */
export async function startCalendarConnection(): Promise<CalendarActionResult> {
  const provider = calendarProvider();
  if (!provider) return { ok: false, code: "calendar_not_configured" };
  if (!getVault().ok) return { ok: false, code: "vault_not_configured" };
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const { data, error } = await context.supabase.rpc("begin_connection", {
    target_org: context.firm.id,
    target_provider: CALENDAR_PROVIDER,
    target_external_id: null,
    target_label: "Google Agenda",
  });
  const answer = (data ?? {}) as { ok?: boolean; code?: string; connection_id?: string };
  if (error || !answer.ok || !answer.connection_id) {
    return { ok: false, code: error ? "failed" : String(answer.code ?? "failed") };
  }
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(CALENDAR_STATE_COOKIE, `${state}.${answer.connection_id}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/connections/google",
    maxAge: 600,
  });
  return { ok: true, code: "redirect", url: provider.authorizationUrl({ state, redirectUri: calendarRedirectUri() }) };
}

/**
 * Takes a calendar under the grant in hand: the one the firm had (`retake`)
 * or a new one (`new`). A grant Google refused is said to the firm and to
 * the connection, as the worker says it, so the screen offers connecting
 * again.
 */
async function takeWithGrant(mode: "retake" | "new"): Promise<CalendarActionResult> {
  const provider = calendarProvider();
  if (!provider) return { ok: false, code: "calendar_not_configured" };
  const current = await currentConnection();
  if (!current.ok) return current;
  if (!current.connection || !["connected", "error"].includes(current.connection.status)) {
    return { ok: false, code: "not_connected" };
  }
  const place = { orgId: current.firm.id, connectionId: current.connection.id };
  const grant = await calendarGrant(place, mode === "new" ? "calendar.create" : "calendar.retake");
  if (!grant.ok) return { ok: false, code: grant.code };
  const service = createServiceClient();
  const { data: previous } = await service
    .from("firm_calendars")
    .select("calendar_id, name, status, problem")
    .eq("org_id", current.firm.id)
    .maybeSingle();
  const taken = await takeCalendar(
    provider,
    grant.grant,
    (previous as PreviousCalendar) ?? null,
    current.firm.name,
    mode,
  );
  if (!taken.ok) {
    if (taken.code === "grant_refused") {
      // Google no longer honours the grant: the calendar in use stops and the connection says so.
      if (previous?.status === "active") {
        await service.rpc("firm_calendar_lost", {
          target_org: current.firm.id,
          target_calendar: String(previous.calendar_id),
          target_problem: "auth",
        });
      }
      const access = getVault();
      if (access.ok) await access.vault.report(place, false, "grant_refused").catch(() => undefined);
      revalidatePath("/settings/connections");
    }
    return { ok: false, code: taken.code };
  }
  const { data } = await service.rpc("record_firm_calendar", {
    target_org: current.firm.id,
    target_connection: current.connection.id,
    target_calendar: taken.calendarId,
    target_name: taken.name,
    target_by: current.userId,
  });
  if (!(data as { ok?: boolean } | null)?.ok) return { ok: false, code: "failed" };
  await settleCalendarSync();
  revalidatePath("/settings/connections");
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  return { ok: true, code: taken.reused ? "retaken" : "recreated" };
}

/** Takes back, under the grant in hand, the calendar the firm had: no new consent, never a new calendar. */
export async function retakeCalendar(): Promise<CalendarActionResult> {
  return takeWithGrant("retake");
}

/** Makes a new calendar of hearings under the grant in hand: every hearing it is owed is written in it. */
export async function recreateCalendar(): Promise<CalendarActionResult> {
  return takeWithGrant("new");
}

/** Cuts the firm's calendar: the grant is given back to Google, then discarded; the calendar stays in the account. */
export async function disconnectCalendar(): Promise<CalendarActionResult> {
  const current = await currentConnection();
  if (!current.ok) return current;
  if (!current.connection) return { ok: false, code: "not_connected" };
  const provider = calendarProvider();
  if (provider && ["connected", "error"].includes(current.connection.status)) {
    const grant = await calendarGrant(
      { orgId: current.firm.id, connectionId: current.connection.id },
      "calendar.revoke",
    );
    if (grant.ok) await provider.revoke(grant.grant).catch(() => undefined);
  }
  const context = await getMemberContext();
  if (!context) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("disconnect_connection", {
    target_connection: current.connection.id,
  });
  if (error || !(data as { ok?: boolean } | null)?.ok) return { ok: false, code: "failed" };
  revalidatePath("/settings/connections");
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  return { ok: true, code: "disconnected" };
}
