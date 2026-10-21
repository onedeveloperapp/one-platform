import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import {
  CALENDAR_PROVIDER,
  CALENDAR_STATE_COOKIE,
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
import { CalendarAuthError } from "@flyee/calendar/types";

/**
 * Where Google sends a person back after the consent to the firm's calendar
 * of hearings (`startCalendarConnection`). The state must be the one the
 * cookie of this person's own start kept, for the calendar connection it
 * names, of the firm this person manages; then the grant is sealed in the
 * vault and the firm's calendar is taken (`takeCalendar`): the one it had,
 * when the account that consented may still write it (its own, or one shared
 * with it to make changes) and it was not deleted in Google; a new one
 * otherwise; and none when the account could not be asked (the card then
 * offers taking it back or a new one). Every hearing is then owed its event.
 * Nothing of the grant is ever in an address, a log or a message, and a
 * grant is never given back here: revoking one token takes every grant the
 * account gave the platform.
 */

const back = (request: NextRequest, outcome: string) => {
  const destination = new URL("/settings/connections", request.url);
  destination.searchParams.set("agenda", outcome);
  return NextResponse.redirect(destination);
};

const same = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const kept = cookieStore.get(CALENDAR_STATE_COOKIE)?.value ?? "";
  cookieStore.delete({ name: CALENDAR_STATE_COOKIE, path: "/api/connections/google" });
  const [state, connectionId] = kept.split(".");
  const query = request.nextUrl.searchParams;
  if (!state || !connectionId || !same(state, query.get("state") ?? "")) return back(request, "expirada");

  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return back(request, "erro");
  if (await connectionRefusal(context)) return back(request, "erro");
  const firm = context.firm;
  const service = createServiceClient();
  const undo = async () => {
    await context.supabase.rpc("disconnect_connection", { target_connection: connectionId });
  };

  const { data: connection } = await context.supabase
    .from("connections")
    .select("id, status")
    .eq("id", connectionId)
    .eq("org_id", firm.id)
    .eq("provider", CALENDAR_PROVIDER)
    .maybeSingle();
  if (!connection) return back(request, "erro");
  if (query.get("error")) {
    if (connection.status === "pending") await undo();
    return back(request, "recusada");
  }

  const provider = calendarProvider();
  const access = getVault();
  const code = query.get("code") ?? "";
  if (!provider || !access.ok || !code) return back(request, "erro");

  let refreshToken: string;
  let scopes: string[];
  try {
    ({ refreshToken, scopes } = await provider.exchangeCode({ code, redirectUri: calendarRedirectUri() }));
  } catch (thrown) {
    if (connection.status === "pending") await undo();
    return back(
      request,
      thrown instanceof CalendarAuthError && thrown.code === "scope_not_granted" ? "sem-permissao" : "erro",
    );
  }
  const place = { orgId: firm.id, connectionId };
  const sealed = await access.vault.seal(
    place,
    { refresh_token: refreshToken },
    { metadata: { scopes: scopes.join(" ") } },
  );
  if (sealed.kind !== "sealed") {
    // The token is let go unused. Giving it back would take with it a grant of the same account still in use.
    if (connection.status === "pending") await undo();
    return back(request, "erro");
  }

  // The firm's calendar: the one it had, when this account may still write it; a new one otherwise. When the
  // account could not be asked, nothing is made: the card offers taking it back, or a new one, by choice.
  const { data: previous } = await service
    .from("firm_calendars")
    .select("calendar_id, name, status, problem")
    .eq("org_id", firm.id)
    .maybeSingle();
  const taken = await takeCalendar(
    provider,
    { refreshToken },
    (previous as PreviousCalendar) ?? null,
    firm.name,
    "again",
  );
  if (!taken.ok) return back(request, "sem-agenda");
  const { data: recorded } = await service.rpc("record_firm_calendar", {
    target_org: firm.id,
    target_connection: connectionId,
    target_calendar: taken.calendarId,
    target_name: taken.name,
    target_by: context.userId,
  });
  if (!(recorded as { ok?: boolean } | null)?.ok) return back(request, "erro");
  await settleCalendarSync();
  return back(request, "conectada");
}
