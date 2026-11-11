"use server";

import { revalidatePath } from "next/cache";

import { settleCalendarSync, settleHearingSync } from "@/lib/hearings/calendar-work";
import { isHearingKind, isHearingMode, isHearingOutcome } from "@/lib/hearings/hearings";
import { getMemberContext } from "@/lib/member/context";
import { settleFirmNotices } from "@/lib/notices/work";

/**
 * What a person of the firm does with a hearing (migration 0037): write it,
 * change it while it is still to happen, say what came of it, and ask for
 * what the firm's calendar could not take. Every write is a function of the
 * database, which decides who may; the event in the firm's calendar is the
 * backend's, asked for at once and never waited for (`settleHearingSync`).
 */

export type HearingActionResult =
  | { ok: true; code: string; id?: string; calendar?: boolean }
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null; id?: string; calendar?: boolean };

function fold(data: unknown, error: { message: string } | null): HearingActionResult {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return {
    ok: true,
    code: String(answer.code ?? "saved"),
    ...(isId(answer.id) ? { id: answer.id } : {}),
    calendar: answer.calendar === true,
  };
}

/** Every screen a hearing shows on, read again after a write. */
function refresh(caseId: string | null) {
  revalidatePath("/agenda");
  revalidatePath("/inicio");
  revalidatePath("/publicacoes");
  if (caseId) revalidatePath(`/casos/${caseId}`);
}

async function caseOf(hearingId: string): Promise<string | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data } = await context.supabase
    .from("hearings")
    .select("case_id")
    .eq("id", hearingId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  return (data?.case_id as string | undefined) ?? null;
}

const text = (value: unknown, most: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, most) : null;

export type HearingInput = {
  /** A hearing to change; none for a new one. */
  hearingId?: string | null;
  /** The lawsuit of a new one. */
  proceedingId?: string | null;
  kind: string;
  mode: string;
  /**
   * The day and the time as the court says them, in `timeZone`: the court's when none is given and the court
   * has one legal time; a court whose comarcas keep more than one refuses a new hearing without it.
   */
  day: string;
  time: string;
  timeZone?: string | null;
  place?: string | null;
  link?: string | null;
  attendeeUserId?: string | null;
  attendeeName?: string | null;
  /**
   * The WhatsApp of an attendee from outside the firm (0187), for ONE to know their report of the hearing. Empty
   * keeps what is on record; a colleague's hearing takes it off.
   */
  attendeePhone?: string | null;
  notes?: string | null;
  /** The publication of the lawsuit it came from. */
  publicationId?: string | null;
};

/** A person writes a hearing, or changes one still to happen. */
export async function saveHearing(input: HearingInput): Promise<HearingActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const hearingId = isId(input?.hearingId) ? input.hearingId : null;
  const proceedingId = isId(input?.proceedingId) ? input.proceedingId : null;
  if (!hearingId && !proceedingId) return { ok: false, code: "not_found" };
  if (!isHearingKind(input.kind)) return { ok: false, code: "invalid_data", field: "kind" };
  if (!isHearingMode(input.mode)) return { ok: false, code: "invalid_data", field: "mode" };
  if (!DAY.test(String(input.day ?? ""))) return { ok: false, code: "invalid_data", field: "day" };
  if (!TIME.test(String(input.time ?? ""))) return { ok: false, code: "invalid_data", field: "time" };
  const phone = typeof input.attendeePhone === "string" ? input.attendeePhone.replace(/\D/g, "") : "";
  if (phone && !/^[0-9]{10,13}$/.test(phone)) return { ok: false, code: "invalid_data", field: "attendee_phone" };
  const fields = {
    kind: input.kind,
    mode: input.mode,
    day: input.day,
    time: input.time,
    ...(text(input.timeZone, 60) ? { time_zone: text(input.timeZone, 60) } : {}),
    place: text(input.place, 300),
    link: text(input.link, 500),
    attendee_user_id: isId(input.attendeeUserId) ? input.attendeeUserId : null,
    attendee_name: text(input.attendeeName, 120),
    notes: text(input.notes, 1000),
    ...(isId(input.publicationId) ? { publication_id: input.publicationId } : {}),
  };
  const { data, error } = await context.supabase.rpc("save_hearing", {
    target_hearing: hearingId,
    target_proceeding: hearingId ? null : proceedingId,
    target_fields: fields,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  const id = result.id ?? hearingId;
  // Who goes from outside the firm is known by their WhatsApp; a colleague by the one on their profile.
  if (id && (phone ? fields.attendee_name : hearingId && !fields.attendee_name)) {
    await context.supabase.rpc("set_hearing_attendee_phone", { target_hearing: id, target_phone: phone || null });
  }
  if (id && result.code !== "unchanged") {
    await settleHearingSync(id, result.calendar === true);
    // The client is told by the notices: a test case's at once, a real case's after its minutes (0103).
    await settleFirmNotices(context.firm.id);
  }
  refresh(id ? await caseOf(id) : null);
  return result;
}

/** What came of a hearing: held (with what came of it), cancelled (with why), or put back to be held. */
export async function setHearingStatus(input: {
  hearingId: string;
  status: "scheduled" | "held" | "cancelled";
  outcome?: string | null;
  note?: string | null;
}): Promise<HearingActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.hearingId)) return { ok: false, code: "not_found" };
  if (!["scheduled", "held", "cancelled"].includes(input.status))
    return { ok: false, code: "invalid_data", field: "status" };
  const { data, error } = await context.supabase.rpc("set_hearing_status", {
    target_hearing: input.hearingId,
    target_status: input.status,
    target_outcome: isHearingOutcome(input.outcome) ? input.outcome : null,
    target_note: text(input.note, 1000),
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  if (result.code !== "unchanged") {
    await settleHearingSync(input.hearingId, result.calendar === true);
    await settleFirmNotices(context.firm.id);
  }
  refresh(await caseOf(input.hearingId));
  return result;
}

/** The events the firm's calendar could not take, asked again. */
export async function retryHearingSyncs(): Promise<HearingActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("retry_hearing_syncs", { target_org: context.firm.id });
  const result = fold(data, error);
  if (result.ok) {
    await settleCalendarSync();
    refresh(null);
  }
  return result;
}
