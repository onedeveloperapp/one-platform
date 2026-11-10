import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

import { addDays, readAgendaItems } from "@/lib/agenda/agenda";
import { agendaEvents, writeIcs } from "@/lib/agenda/ics";
import { todayInBrasilia } from "@/lib/deadlines/deadlines";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";

/**
 * A person's calendar link (migration 0132), which the iPhone, Outlook and Google subscribe to. Public: a calendar
 * application has no session, and the token in the address is the only credential; ONE keeps only its SHA-256, so a
 * link that was ended, replaced, or whose person left the firm answers 404. The events name the act or "Prazo" and the
 * case's number, never anybody of the case.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) {
    return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const service = createServiceClient();
  const { data, error } = await service.rpc("agenda_calendar_feed", { target_hash: hash });
  if (error) return new NextResponse("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!data) return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const feed = data as Record<string, unknown>;
  const days = typeof feed.internal_days === "number" ? feed.internal_days : 0;
  const items = readAgendaItems(feed, days);
  const userId = typeof feed.user_id === "string" ? feed.user_id : "";
  const today = todayInBrasilia();
  const events = agendaEvents(
    items,
    feed.whole_firm === true ? { kind: "all" } : { kind: "person", id: userId },
    { from: addDays(today, -30), to: addDays(today, 180) },
    BRAND.siteUrl,
    new Date(),
  );
  return new NextResponse(writeIcs("ONE · Agenda", events), {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="agenda.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
