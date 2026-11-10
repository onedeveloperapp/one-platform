"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";
import {
  ASKED_HOW,
  EXPORT_COLUMNS,
  type ExportColumn,
  isPeopleView,
  PEOPLE_SHOWN,
  type PeoplePage,
  readPeoplePage,
  readSegmentFilters,
  type SegmentFilters,
} from "@/lib/people/people";

/**
 * The writes and the searched reads of the firm's people (migrations 0133 and 0134), each through its database
 * function, which checks who may and keeps it on the record. A search travels in the request's body.
 */

type Result = { ok: true } | { ok: false; code: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOW = ["link", ...ASKED_HOW] as const;

async function rpc(
  name: string,
  args: Record<string, unknown>,
  withFirm = true,
): Promise<{ ok: boolean; data: unknown }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, data: null };
  const { data, error } = await context.supabase.rpc(name, withFirm ? { target_org: context.firm.id, ...args } : args);
  return error ? { ok: false, data: null } : { ok: true, data };
}

const answerOf = (data: unknown): { ok: true; answer: Record<string, unknown> } | { ok: false; code: string } => {
  const answer = (data ?? {}) as Record<string, unknown>;
  return answer.ok === true
    ? { ok: true, answer }
    : { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
};

/** A page of the list, searched (the list on the screen, as the person types). */
export async function listPeople(
  view: string,
  search: string,
  page: number,
): Promise<{ ok: true; page: PeoplePage } | { ok: false }> {
  if (!isPeopleView(view)) return { ok: false };
  const read = await rpc("firm_people", {
    target_view: view,
    target_search: String(search ?? "").slice(0, 120) || null,
    target_limit: PEOPLE_SHOWN,
    target_offset: Math.max(Math.trunc(page) || 0, 0) * PEOPLE_SHOWN,
  });
  return read.ok ? { ok: true, page: readPeoplePage(read.data) } : { ok: false };
}

/** Anybody of the firm records that a person asked for no marketing, or to receive it again, saying how. */
export async function setPersonMarketing(personId: string, off: boolean, how: string | null): Promise<Result> {
  if (!UUID.test(personId)) return { ok: false, code: "not_found" };
  if (off && !(ASKED_HOW as readonly string[]).includes(how ?? "")) return { ok: false, code: "invalid_data" };
  const read = await rpc("set_person_marketing", { target_person: personId, target_off: off, target_how: how });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (answer.ok) revalidatePath(`/pessoas/${personId}`);
  return answer.ok ? { ok: true } : answer;
}

/** Who decides for the firm exports everything the firm keeps of a person, with the second factor. */
export async function exportPersonData(
  personId: string,
  how: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; code: string }> {
  if (!UUID.test(personId) || !(HOW as readonly string[]).includes(how)) return { ok: false, code: "invalid_data" };
  const read = await rpc("person_data_export", { target_person: personId, target_how: how });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (!answer.ok) return answer;
  revalidatePath(`/pessoas/${personId}`);
  const data = { ...answer.answer };
  delete data.ok;
  return { ok: true, data };
}

/** Who decides for the firm answers a request to erase a person's data, with the second factor. */
export async function erasePerson(personId: string, how: string): Promise<Result> {
  if (!UUID.test(personId) || !(HOW as readonly string[]).includes(how)) return { ok: false, code: "invalid_data" };
  const read = await rpc("erase_person", { target_person: personId, target_how: how });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  revalidatePath(`/pessoas/${personId}`);
  return answer.ok ? { ok: true } : answer;
}

/** A partner accepts the firm's marketing term in force, with the second factor. */
export async function acceptMarketingTerm(version: string): Promise<Result> {
  const read = await rpc("accept_marketing_term", { target_version: String(version ?? "").slice(0, 60) });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (answer.ok) revalidatePath("/pessoas");
  return answer.ok ? { ok: true } : answer;
}

/** How many people some filters hold now. */
export async function countSegment(
  filters: SegmentFilters,
): Promise<{ ok: true; count: number } | { ok: false; code: string }> {
  const read = await rpc("segment_count", { target_filters: readSegmentFilters(filters) });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (!answer.ok) return answer;
  return { ok: true, count: typeof answer.answer.count === "number" ? answer.answer.count : 0 };
}

/** Makes or changes a segment. */
export async function saveSegment(segmentId: string | null, name: string, filters: SegmentFilters): Promise<Result> {
  if (segmentId !== null && !UUID.test(segmentId)) return { ok: false, code: "not_found" };
  const read = await rpc("save_marketing_segment", {
    target_segment: segmentId,
    target_name: String(name ?? "").slice(0, 80),
    target_filters: readSegmentFilters(filters),
  });
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (answer.ok) revalidatePath("/pessoas");
  return answer.ok ? { ok: true } : answer;
}

/** Archives a segment with its reason, or brings it back (no reason). */
export async function archiveSegment(segmentId: string, reason: string | null): Promise<Result> {
  if (!UUID.test(segmentId)) return { ok: false, code: "not_found" };
  const read = await rpc("archive_marketing_segment", { target_segment: segmentId, target_reason: reason }, false);
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (answer.ok) revalidatePath("/pessoas");
  return answer.ok ? { ok: true } : answer;
}

/** A segment's people with the columns chosen, for the spreadsheet the browser writes; with the second factor. */
export async function exportSegment(
  segmentId: string,
  columns: string[],
): Promise<{ ok: true; columns: ExportColumn[]; rows: Record<string, unknown>[] } | { ok: false; code: string }> {
  if (!UUID.test(segmentId)) return { ok: false, code: "not_found" };
  const wanted = columns.filter((column): column is ExportColumn =>
    (EXPORT_COLUMNS as readonly string[]).includes(column),
  );
  const read = await rpc("export_marketing_segment", { target_segment: segmentId, target_columns: wanted }, false);
  if (!read.ok) return { ok: false, code: "failed" };
  const answer = answerOf(read.data);
  if (!answer.ok) return answer;
  const rows = Array.isArray(answer.answer.rows) ? (answer.answer.rows as Record<string, unknown>[]) : [];
  return { ok: true, columns: wanted, rows };
}
