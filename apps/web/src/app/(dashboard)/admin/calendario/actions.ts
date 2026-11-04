"use server";

import { revalidatePath } from "next/cache";

import { namesOf, sourcesOf } from "@/lib/admin/calendar";
import { requireSuperadmin } from "@/lib/admin/session";
import { settleDeadlineCounts } from "@/lib/deadlines/count-work";

/**
 * What the console of the forensic calendar does (migration 0034): record a
 * year of a court as checked against its act, record or remove a day of it,
 * and keep the acts of the list; and keep what the platform read of how
 * each court decides a family split (0025). The database checks the role and records
 * each change; a change of a court's calendar has every open deadline of that
 * court counted again, right after the answer.
 *
 * A server action is a public endpoint: the role is checked here again.
 */

export type CalendarResult = { ok: true; recounted?: number; days?: number } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COURT = /^TJ[A-Z]{2,3}$/;

type Answer = { ok?: boolean; code?: string; recounted?: number; days?: number };

async function settled(answer: unknown, error: { message: string } | null): Promise<CalendarResult> {
  if (error) return { ok: false, code: "failed" };
  const data = (answer ?? {}) as Answer;
  if (!data.ok) return { ok: false, code: String(data.code ?? "failed") };
  revalidatePath("/admin/calendario");
  revalidatePath("/prazos");
  if ((data.recounted ?? 0) > 0) settleDeadlineCounts();
  return { ok: true, recounted: data.recounted ?? 0, days: data.days };
}

export async function saveCalendarYear(input: {
  court: string;
  year: number;
  sourceUrl: string;
  sourceTitle: string;
  allComarcas: boolean;
  comarcas: string;
  checkedOn: string;
  note: string;
}): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!COURT.test(input?.court ?? "") || !Number.isInteger(input.year) || !DAY.test(input.checkedOn ?? "")) {
    return { ok: false, code: "invalid_value" };
  }
  const { data, error } = await session.supabase.rpc("admin_save_calendar_year", {
    target_court: input.court,
    target_year: input.year,
    target_source_url: String(input.sourceUrl ?? "").trim(),
    target_source_title: String(input.sourceTitle ?? "").trim() || null,
    target_all_comarcas: Boolean(input.allComarcas),
    target_comarcas: namesOf(String(input.comarcas ?? "")),
    target_checked_on: input.checkedOn,
    target_note: String(input.note ?? "").trim() || null,
  });
  return settled(data, error);
}

export async function removeCalendarYear(court: string, year: number): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!COURT.test(court) || !Number.isInteger(year)) return { ok: false, code: "invalid_value" };
  const { data, error } = await session.supabase.rpc("admin_remove_calendar_year", {
    target_court: court,
    target_year: year,
  });
  return settled(data, error);
}

export async function saveCalendarDay(input: {
  court: string;
  day: string;
  lastDay: string | null;
  kind: string;
  label: string;
  proceedingKinds: string[];
  systems: string[];
  comarcas: string;
  sourceUrl: string;
}): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!COURT.test(input?.court ?? "") || !DAY.test(input.day ?? "") || (input.lastDay && !DAY.test(input.lastDay))) {
    return { ok: false, code: "invalid_value" };
  }
  const { data, error } = await session.supabase.rpc("admin_save_calendar_day", {
    target_day_id: null,
    target_court: input.court,
    target_day: input.day,
    target_last_day: input.lastDay || null,
    target_kind: input.kind,
    target_label: String(input.label ?? "").trim(),
    target_proceeding_kinds: (input.proceedingKinds ?? []).filter((kind) => kind === "juizado" || kind === "comum"),
    target_systems: (input.systems ?? []).filter((system) => /^[a-z]{2,10}$/.test(system)),
    target_comarcas: namesOf(String(input.comarcas ?? "")),
    target_source_url: String(input.sourceUrl ?? "").trim() || null,
  });
  return settled(data, error);
}

export async function removeCalendarDay(dayId: string): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!UUID.test(dayId)) return { ok: false, code: "invalid_value" };
  const { data, error } = await session.supabase.rpc("admin_remove_calendar_day", { target_day_id: dayId });
  return settled(data, error);
}

export async function saveDeadlineAct(input: {
  slug: string;
  name: string;
  days: number;
  counting: string;
  proceedingKinds: string[];
  basis: string;
  position: number;
  active: boolean;
}): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_save_deadline_act", {
    target_slug: String(input?.slug ?? "").trim(),
    target_name: String(input.name ?? "").trim(),
    target_days: Number.isInteger(input.days) ? input.days : 0,
    target_counting: input.counting === "calendar" ? "calendar" : "business",
    target_proceeding_kinds: (input.proceedingKinds ?? []).filter((kind) => kind === "juizado" || kind === "comum"),
    target_basis: String(input.basis ?? "").trim(),
    target_position: Number.isInteger(input.position) ? input.position : 100,
    target_active: Boolean(input.active),
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as Answer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/admin/calendario");
  return { ok: true };
}

/** What the platform read of how a court decides a family split, with its sources (one per line, "label | address"). */
export async function saveCourtNote(input: {
  court: string;
  stance: string;
  summary: string;
  sources: string;
  readOn: string;
}): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!COURT.test(input?.court ?? "") || !DAY.test(input.readOn ?? "")) return { ok: false, code: "invalid_value" };
  const read = sourcesOf(String(input.sources ?? ""));
  if (read.unreadable.length > 0 || read.sources.length === 0) return { ok: false, code: "sources_unreadable" };
  const { data, error } = await session.supabase.rpc("admin_save_court_note", {
    target_court: input.court,
    target_topic: "family_split",
    target_stance: input.stance === "divided" ? "divided" : "against",
    target_summary: String(input.summary ?? "").trim(),
    target_sources: read.sources,
    target_read_on: input.readOn,
  });
  return settled(data, error);
}

export async function removeCourtNote(court: string): Promise<CalendarResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (!COURT.test(court)) return { ok: false, code: "invalid_value" };
  const { data, error } = await session.supabase.rpc("admin_remove_court_note", {
    target_court: court,
    target_topic: "family_split",
  });
  return settled(data, error);
}
