"use server";

import { revalidatePath } from "next/cache";

import { settleDeadlineCount } from "@/lib/deadlines/count-work";
import { calendarOf, isDeadlineCounting, isDeadlineTrigger } from "@/lib/deadlines/deadlines";
import { courtCalendar } from "@/lib/deadlines/facts";
import { getMemberContext } from "@/lib/member/context";
import { computeDeadline, type DeadlineResult } from "@flyee/rules/deadlines";
import { readDay } from "@flyee/rules/person";

/**
 * What a person of the firm does with a deadline (migration 0034): see how
 * it would be counted, propose it, correct what it is counted from, ask for
 * its count again, confirm it, say it was done or never was, and reopen it.
 * Every write is a function of the database, which decides who may; a count
 * is the backend's, made right after a write (`settleDeadlineCount`) so the
 * person sees the day at once.
 */

export type DeadlineActionResult =
  | { ok: true; code: string; id?: string; dueOn?: string | null; counted?: boolean }
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isDayText = (value: unknown): value is string => typeof value === "string" && readDay(value) !== null;

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null; id?: string; due_on?: string | null };

function fold(data: unknown, error: { message: string } | null): DeadlineActionResult {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return {
    ok: true,
    code: String(answer.code ?? "saved"),
    ...(isId(answer.id) ? { id: answer.id } : {}),
    ...(answer.due_on !== undefined ? { dueOn: answer.due_on } : {}),
  };
}

/** Every screen a deadline shows on, read again after a write. */
function refresh(caseId: string | null) {
  revalidatePath("/prazos");
  revalidatePath("/inicio");
  revalidatePath("/publicacoes");
  if (caseId) revalidatePath(`/casos/${caseId}`);
}

type Subject = { publicationId?: string | null; proceedingId?: string | null; deadlineId?: string | null };

type CountRequest = Subject & {
  trigger: string;
  /** The day the term runs from, when it does not run from a publication. */
  triggerOn?: string | null;
  days: number;
  counting: string;
  /** For a term of a publication: the day the same act was intimated in the court's own system, when known. */
  portalOn?: string | null;
};

/** What a deadline would come to: counted by the rule over the court's calendar, as the backend will count it. Nothing is written. */
export async function previewDeadline(
  input: CountRequest,
): Promise<{ ok: true; result: DeadlineResult; court: string } | { ok: false; code: string; field?: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const trigger = input?.trigger;
  const counting = input?.counting;
  if (!isDeadlineTrigger(trigger)) return { ok: false, code: "invalid_data", field: "trigger" };
  if (!isDeadlineCounting(counting)) return { ok: false, code: "invalid_data", field: "counting" };
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) {
    return { ok: false, code: "invalid_data", field: "days" };
  }
  const supabase = context.supabase;
  const firmId = context.firm.id;

  let publication: { court: string; available_on: string; proceeding_id: string | null } | null = null;
  let publicationId: string | null = isId(input.publicationId) ? input.publicationId : null;
  let proceedingId: string | null = isId(input.proceedingId) ? input.proceedingId : null;
  let court: string | null = null;
  if (isId(input.deadlineId)) {
    const { data } = await supabase
      .from("deadlines")
      .select("court, publication_id, proceeding_id")
      .eq("id", input.deadlineId)
      .eq("org_id", firmId)
      .maybeSingle();
    if (!data) return { ok: false, code: "not_found" };
    court = data.court as string;
    proceedingId = (data.proceeding_id as string | null) ?? null;
    if (data.publication_id) publicationId = data.publication_id as string;
  }
  if (publicationId) {
    const { data } = await supabase
      .from("publications")
      .select("court, available_on, proceeding_id")
      .eq("id", publicationId)
      .eq("org_id", firmId)
      .maybeSingle();
    if (!data) return { ok: false, code: "not_found" };
    publication = data as { court: string; available_on: string; proceeding_id: string | null };
    proceedingId = publication.proceeding_id ?? proceedingId;
  }
  let place = { proceedingKind: null as string | null, system: null as string | null, comarca: null as string | null };
  if (proceedingId) {
    const { data } = await supabase
      .from("proceedings")
      .select("court, kind, system, comarca")
      .eq("id", proceedingId)
      .eq("org_id", firmId)
      .maybeSingle();
    if (data) {
      court = (data.court as string | null) ?? court;
      place = {
        proceedingKind: data.kind as string,
        system: data.system as string | null,
        comarca: data.comarca as string | null,
      };
    }
  }
  court = court ?? publication?.court ?? null;
  if (!court) return { ok: false, code: "court_unknown" };

  const on = trigger === "publication" ? publication?.available_on : input.triggerOn;
  if (!isDayText(on))
    return { ok: false, code: "invalid_data", field: trigger === "publication" ? "trigger" : "trigger_on" };
  const portalOn = trigger === "publication" && isDayText(input.portalOn) ? input.portalOn : null;
  // The calendar from the year of the earlier start: an intimation in the system may come before the publication.
  const firstDay = portalOn && portalOn < on ? portalOn : on;
  try {
    const rows = await courtCalendar(supabase, court, Number(firstDay.slice(0, 4)));
    const outcome = computeDeadline({
      trigger,
      on,
      days: input.days,
      counting,
      portalOn,
      place,
      calendar: calendarOf(rows.years, rows.days),
    });
    if (!outcome.ok) return { ok: false, code: outcome.code };
    return { ok: true, result: outcome.result, court };
  } catch {
    return { ok: false, code: "failed" };
  }
}

/** The day a deadline came to after its count, read back for the screen. */
async function countedDay(
  deadlineId: string,
): Promise<{ dueOn: string | null; counted: boolean; caseId: string | null }> {
  const context = await getMemberContext();
  if (!context?.firm) return { dueOn: null, counted: false, caseId: null };
  const { data } = await context.supabase
    .from("deadlines")
    .select("due_on, computed_revision, revision, case_id")
    .eq("id", deadlineId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  return {
    dueOn: (data?.due_on as string | null) ?? null,
    counted: Boolean(data && data.computed_revision === data.revision),
    caseId: (data?.case_id as string | null) ?? null,
  };
}

type DeadlineFields = {
  title: string;
  act?: string | null;
  trigger: string;
  triggerOn?: string | null;
  days: number;
  counting: string;
  /** For a term of a publication: the day the act was intimated in the court's own system, or null for none. */
  portalOn?: string | null;
};

const fieldsOf = (input: DeadlineFields) => ({
  target_title: typeof input.title === "string" ? input.title.slice(0, 240) : "",
  target_act: typeof input.act === "string" && input.act.trim() ? input.act.trim().slice(0, 60) : null,
  target_trigger: String(input.trigger ?? ""),
  target_trigger_on: isDayText(input.triggerOn) ? input.triggerOn : null,
  target_days: Number.isInteger(input.days) ? input.days : 0,
  target_counting: String(input.counting ?? ""),
});

/** A person proposes a deadline of a publication or of a filed lawsuit: it is counted at once and waits for who confirms. */
export async function proposeDeadline(
  input: DeadlineFields & { publicationId?: string | null; proceedingId?: string | null },
): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const publicationId = isId(input?.publicationId) ? input.publicationId : null;
  const proceedingId = isId(input?.proceedingId) ? input.proceedingId : null;
  if (!publicationId && !proceedingId) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("propose_deadline", {
    target_publication: publicationId,
    target_proceeding: publicationId ? null : proceedingId,
    ...fieldsOf(input),
  });
  const result = fold(data, error);
  if (!result.ok || !result.id) return result;
  // The day of the intimation in the system, when the person gave it: the deadline is counted from the earlier (0144).
  const portal = publicationId && isDayText(input.portalOn) ? await setPortalDay(result.id, input.portalOn) : null;
  await settleDeadlineCount(result.id);
  const counted = await countedDay(result.id);
  refresh(counted.caseId);
  if (portal && !portal.ok) return portal;
  return { ...result, dueOn: counted.dueOn, counted: counted.counted };
}

/** The day the act of a deadline's publication was intimated in the court's own system, given or taken back (0144). */
async function setPortalDay(deadlineId: string, day: string | null): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_deadline_portal_day", {
    target_deadline: deadlineId,
    target_day: day,
  });
  return fold(data, error);
}

/** The day of the intimation in the system a deadline has, for the form that corrects it. */
export async function readDeadlinePortalDay(deadlineId: string): Promise<string | null> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(deadlineId)) return null;
  const { data } = await context.supabase
    .from("deadlines")
    .select("portal_on")
    .eq("id", deadlineId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  const day = (data?.portal_on as string | null | undefined) ?? null;
  return isDayText(day) ? day : null;
}

/**
 * A deadline corrected: what it is counted from (it goes back to be counted
 * and confirmed), or only its words (its count and its confirmation stay).
 */
export async function updateDeadline(input: DeadlineFields & { deadlineId: string }): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.deadlineId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("update_deadline", {
    target_deadline: input.deadlineId,
    ...fieldsOf(input),
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  // Only a term of a publication takes the day of the system; `undefined` leaves it as it is.
  const portal =
    input.trigger === "publication" && input.portalOn !== undefined
      ? await setPortalDay(input.deadlineId, isDayText(input.portalOn) ? input.portalOn : null)
      : null;
  if (portal && !portal.ok) return portal;
  if (result.code === "updated" || portal?.code === "set") await settleDeadlineCount(input.deadlineId);
  const counted = await countedDay(input.deadlineId);
  refresh(counted.caseId);
  return { ...result, dueOn: counted.dueOn, counted: counted.counted };
}

/**
 * The count of a deadline the backend gave up on, asked again: its attempts
 * start over and it is counted at once, when it can be.
 */
export async function retryDeadlineCount(deadlineId: string): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(deadlineId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("retry_deadline_count", { target_deadline: deadlineId });
  const result = fold(data, error);
  if (!result.ok) return result;
  if (result.code === "retried") await settleDeadlineCount(deadlineId);
  const counted = await countedDay(deadlineId);
  refresh(counted.caseId);
  return { ...result, dueOn: counted.dueOn, counted: counted.counted };
}

/**
 * Who runs the firm's deadlines confirms one: on the counted day (no day
 * given), or on another with the reason. The revision is the one whose
 * count the person read.
 */
export async function confirmDeadline(input: {
  deadlineId: string;
  revision: number;
  dueOn?: string | null;
  reason?: string | null;
}): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.deadlineId)) return { ok: false, code: "not_found" };
  if (!Number.isInteger(input.revision)) return { ok: false, code: "changed" };
  if (input.dueOn != null && !isDayText(input.dueOn)) return { ok: false, code: "invalid_data", field: "due_on" };
  const { data, error } = await context.supabase.rpc("confirm_deadline", {
    target_deadline: input.deadlineId,
    target_revision: input.revision,
    target_due_on: input.dueOn ?? null,
    target_reason: typeof input.reason === "string" ? input.reason.slice(0, 1000) : null,
  });
  const result = fold(data, error);
  if (result.ok) refresh((await countedDay(input.deadlineId)).caseId);
  return result;
}

/**
 * A deadline of a lawsuit, recorded from a day, said to be the one of a
 * publication of that lawsuit: the publication then has its deadline.
 */
export async function linkDeadlinePublication(input: {
  deadlineId: string;
  publicationId: string;
}): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.deadlineId) || !isId(input?.publicationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("link_deadline_publication", {
    target_deadline: input.deadlineId,
    target_publication: input.publicationId,
  });
  const result = fold(data, error);
  if (result.ok) refresh((await countedDay(input.deadlineId)).caseId);
  return result;
}

/** The act was done. */
export async function completeDeadline(input: {
  deadlineId: string;
  note?: string | null;
}): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.deadlineId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("complete_deadline", {
    target_deadline: input.deadlineId,
    target_note: typeof input.note === "string" ? input.note.slice(0, 1000) : null,
  });
  const result = fold(data, error);
  if (result.ok) refresh((await countedDay(input.deadlineId)).caseId);
  return result;
}

/** There was no such deadline after all: said with why. */
export async function dismissDeadline(input: { deadlineId: string; reason: string }): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.deadlineId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("dismiss_deadline", {
    target_deadline: input.deadlineId,
    target_reason: typeof input.reason === "string" ? input.reason.slice(0, 1000) : null,
  });
  const result = fold(data, error);
  if (result.ok) refresh((await countedDay(input.deadlineId)).caseId);
  return result;
}

/** A deadline marked done or dismissed by mistake goes back to be counted and confirmed. */
export async function reopenDeadline(deadlineId: string): Promise<DeadlineActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(deadlineId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("reopen_deadline", { target_deadline: deadlineId });
  const result = fold(data, error);
  if (!result.ok) return result;
  await settleDeadlineCount(deadlineId);
  const counted = await countedDay(deadlineId);
  refresh(counted.caseId);
  return { ...result, dueOn: counted.dueOn, counted: counted.counted };
}
