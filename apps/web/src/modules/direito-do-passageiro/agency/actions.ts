"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomBytes } from "node:crypto";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import { memberUrl } from "@/lib/messages/format";
import { agencyAccess } from "@/modules/direito-do-passageiro/agency/facts";
import type { PaxImportRow } from "@/modules/direito-do-passageiro/agency/import";
import {
  PAX_DOCUMENT_KINDS,
  PAX_FIELDS,
  PAX_FILTERS,
  PAX_PAGE_SIZE,
  type PaxFilter,
  type PaxPage,
  paxPageOf,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { removeForgottenBytes } from "@/modules/direito-do-passageiro/agency/retention-work";
import { finishPaxUpload } from "@/modules/direito-do-passageiro/agency/uploads";
import { createServiceClient } from "@flyee/auth/service";

/**
 * What somebody of a travel agency does with the passengers of its partnership (migration 0070), as server
 * actions. No rule is decided here: each action calls the function of the database that checks who asks (a
 * person of the agency, the partnership active, the second factor, never a support visit) and records the audit
 * event. What this file adds is what the database cannot do: mint the token of a passenger's link (only its hash
 * is kept), mint the signed address a file is sent to and measure what arrived, and fold an answer into a code the
 * screens have words for. A server action is a public endpoint: the agency and its partnership always come from
 * the caller's own session.
 */

export type PaxResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null; position?: number | null };

const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_authorized",
  "partnership_ended",
  "invalid_token_hash",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null; position?: number | null } & Record<
  string,
  unknown
>;

/** Folds a function's answer into a result. Every call names its function as a literal, for `check:db-refs`. */
function fold(data: unknown, error: { message?: string } | null): PaxResult<{ data: RpcAnswer }> {
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (answer.ok === false) {
    return {
      ok: false,
      code: String(answer.code ?? "failed"),
      field: answer.field ?? null,
      position: answer.position ?? null,
    };
  }
  return { ok: true, code: typeof answer.code === "string" ? answer.code : "done", data: answer };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const notAllowed = { ok: false as const, code: "not_authorized" };

function service() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

const refresh = () => revalidatePath("/parceiro/passageiros", "layout");

/** The passengers of the partnership, a page at a time. The search travels here, never in the address. */
export async function listPassengers(input: {
  search: string;
  filter: PaxFilter;
  offset: number;
}): Promise<PaxResult<{ page: PaxPage }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const filter = (PAX_FILTERS as readonly string[]).includes(input?.filter) ? input.filter : "all";
  const { data, error } = await access.context.supabase.rpc("pax_travelers_page", {
    target_partnership: access.partnership.id,
    target_search:
      String(input?.search ?? "")
        .slice(0, 100)
        .trim() || null,
    target_filter: filter,
    target_limit: PAX_PAGE_SIZE,
    target_offset: Math.max(0, Math.trunc(Number(input?.offset ?? 0)) || 0),
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  return { ok: true, code: "read", page: paxPageOf(data) };
}

/** A few passengers by name or CPF, for a picker (who travels along, who answers for a child). */
export async function findPassengers(
  term: string,
): Promise<PaxResult<{ people: { id: string; fullName: string; minor: boolean }[] }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const search = String(term ?? "")
    .slice(0, 100)
    .trim();
  const { data, error } = await access.context.supabase.rpc("pax_travelers_page", {
    target_partnership: access.partnership.id,
    target_search: search || null,
    target_filter: "all",
    target_limit: 10,
    target_offset: 0,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  return {
    ok: true,
    code: "read",
    people: paxPageOf(data).rows.map((row) => ({ id: row.id, fullName: row.fullName, minor: row.minor })),
  };
}

/** Adds a passenger, or changes one: only the fields named, an empty one cleared. */
export async function savePassenger(input: {
  travelerId: string | null;
  fields: Record<string, string | null>;
  guardianId: string | null;
}): Promise<PaxResult<{ travelerId: string }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const fields: Record<string, string | null> = {};
  for (const field of PAX_FIELDS) {
    if (!input?.fields || !(field in input.fields)) continue;
    const value = input.fields[field];
    fields[field] = typeof value === "string" ? value.slice(0, 300) : null;
  }
  const { data, error } = await access.context.supabase.rpc("pax_save_traveler", {
    target_partnership: access.partnership.id,
    target_traveler: isId(input?.travelerId) ? input.travelerId : null,
    target_fields: fields,
    target_guardian: isId(input?.guardianId) ? input.guardianId : null,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  return { ok: true, code: result.code, travelerId: String(result.data.traveler_id ?? "") };
}

/** Adds a trip, or changes one: its holder (an adult), who goes along, its locator and its legs. */
export async function saveTrip(input: {
  tripId: string | null;
  holderId: string;
  travelerIds: string[];
  locator: string;
  legs: { flight_number: string; origin_iata: string; destination_iata: string; departure: string; arrival: string }[];
}): Promise<PaxResult<{ tripId: string }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  if (!isId(input?.holderId)) return { ok: false, code: "traveler_not_found", field: "holder" };
  const legs = (Array.isArray(input?.legs) ? input.legs : []).slice(0, 6).map((leg) => ({
    flight_number: String(leg?.flight_number ?? "").slice(0, 12),
    origin_iata: String(leg?.origin_iata ?? "").slice(0, 3),
    destination_iata: String(leg?.destination_iata ?? "").slice(0, 3),
    departure: String(leg?.departure ?? "").slice(0, 16),
    arrival: String(leg?.arrival ?? "").slice(0, 16),
  }));
  const { data, error } = await access.context.supabase.rpc("pax_save_trip", {
    target_partnership: access.partnership.id,
    target_trip: isId(input?.tripId) ? input.tripId : null,
    target_holder: input.holderId,
    target_travelers: (Array.isArray(input?.travelerIds) ? input.travelerIds : []).filter(isId).slice(0, 20),
    target_locator: String(input?.locator ?? "").slice(0, 20),
    target_legs: legs,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  return { ok: true, code: result.code, tripId: String(result.data.trip_id ?? "") };
}

/** The first half of sending a document: the reservation, and the signed address the browser sends the bytes to. */
export async function startPassengerUpload(input: {
  travelerId: string;
  kind: string;
  tripId: string | null;
  name: string;
  mime: string;
  bytes: number;
}): Promise<PaxResult<{ fileId: string; storagePath: string; uploadToken: string }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const backend = service();
  if (!backend) return { ok: false, code: "unavailable" };
  if (!isId(input?.travelerId) || !(PAX_DOCUMENT_KINDS as readonly string[]).includes(input?.kind)) {
    return { ok: false, code: "invalid_kind" };
  }
  const { data, error } = await access.context.supabase.rpc("pax_reserve_document", {
    target_traveler: input.travelerId,
    target_kind: input.kind,
    target_trip: isId(input.tripId) ? input.tripId : null,
    target_name: String(input.name ?? "").slice(0, 200),
    target_mime: String(input.mime ?? ""),
    target_bytes: Math.trunc(Number(input.bytes ?? 0)),
  });
  const reserved = fold(data, error);
  if (!reserved.ok) return reserved;
  const storagePath = String(reserved.data.storage_path ?? "");
  const { data: signed, error: signError } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(storagePath);
  // The reservation stays: it expires by itself and the upkeep removes it.
  if (signError || !signed) return { ok: false, code: "storage_unavailable" };
  return {
    ok: true,
    code: "reserved",
    fileId: String(reserved.data.file_id ?? ""),
    storagePath,
    uploadToken: signed.token,
  };
}

/** The second half: the backend measures what arrived, and the AI reads what was kept. */
export async function finishPassengerUpload(fileId: string): Promise<PaxResult> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const backend = service();
  if (!backend || !isId(fileId)) return { ok: false, code: "not_found" };
  const finished = await finishPaxUpload(backend, fileId, { partnerId: access.agency.id });
  if (!finished.ok) return finished;
  refresh();
  return { ok: true, code: finished.code };
}

/** A short signed address to open a document the agency holds: its row read under the person's own session. */
export async function openPassengerFile(fileId: string): Promise<PaxResult<{ url: string }>> {
  const access = await agencyAccess();
  if (!access.ok || !isId(fileId)) return notAllowed;
  const backend = service();
  if (!backend) return { ok: false, code: "unavailable" };
  const { data: file } = await access.context.supabase
    .from("files")
    .select("id, storage_path, status, name")
    .eq("id", fileId)
    .eq("partner_id", access.agency.id)
    .maybeSingle();
  if (!file || file.status !== "stored") return { ok: false, code: "not_found" };
  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUrl(String(file.storage_path), 60, { download: String(file.name ?? "documento") });
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return { ok: true, code: "signed", url: signed.signedUrl };
}

/** Who manages the agency registers a new version of the clause the passenger reads on the link. */
export async function saveClause(body: string): Promise<PaxResult<{ version: number | null }>> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const { data, error } = await access.context.supabase.rpc("pax_save_consent_term", {
    target_partner: access.agency.id,
    target_body: String(body ?? "").slice(0, 2000),
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  const version = Number(result.data.version);
  return { ok: true, code: result.code, version: Number.isFinite(version) ? version : null };
}

/**
 * A new link for an adult passenger to agree on (it covers the children they answer for): the token goes back to
 * the agency once, to send to the passenger; only its hash is kept, and the link the passenger had ends.
 */
export async function issueAgreementLink(travelerId: string): Promise<PaxResult<{ url: string; expiresAt: string }>> {
  const access = await agencyAccess();
  if (!access.ok || !isId(travelerId)) return notAllowed;
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data, error } = await access.context.supabase.rpc("pax_issue_confirm_link", {
    target_traveler: travelerId,
    target_token_hash: hash,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  return {
    ok: true,
    code: result.code,
    url: memberUrl(`/acordo/${token}`),
    expiresAt: String(result.data.expires_at ?? ""),
  };
}

/** Lines of a spreadsheet, a few at a time: each refused alone, with why. */
export async function importPassengers(rows: PaxImportRow[]): Promise<
  PaxResult<{
    added: number;
    matched: number;
    tripsAdded: number;
    legsAdded: number;
    problems: { line: number | null; code: string }[];
  }>
> {
  const access = await agencyAccess();
  if (!access.ok) return notAllowed;
  const lines = (Array.isArray(rows) ? rows : []).slice(0, 200);
  const { data, error } = await access.context.supabase.rpc("pax_import_rows", {
    target_partnership: access.partnership.id,
    target_rows: lines,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  const count = (value: unknown) => Math.max(0, Math.trunc(Number(value ?? 0)) || 0);
  const problems = (Array.isArray(result.data.problems) ? result.data.problems : []).map((item) => {
    const problem = (item ?? {}) as { line?: unknown; code?: unknown };
    return {
      line: typeof problem.line === "number" ? problem.line : null,
      code: typeof problem.code === "string" ? problem.code : "not_written",
    };
  });
  return {
    ok: true,
    code: result.code,
    added: count(result.data.added),
    matched: count(result.data.matched),
    tripsAdded: count(result.data.trips_added),
    legsAdded: count(result.data.legs_added),
    problems,
  };
}

/** What the agency keeps of a passenger, for them to take (their right of access): a file the screen hands over. */
export async function exportPassenger(travelerId: string): Promise<PaxResult<{ data: unknown }>> {
  const access = await agencyAccess();
  if (!access.ok || !isId(travelerId)) return notAllowed;
  const { data, error } = await access.context.supabase.rpc("pax_export_traveler", { target_traveler: travelerId });
  const result = fold(data, error);
  if (!result.ok) return result;
  return { ok: true, code: result.code, data: result.data.data ?? null };
}

/**
 * Who manages the agency deletes a passenger, on their request or because the agency no longer covers them: the
 * record and everything of it; the bytes of their files are removed right after (and by the daily sweep, if not).
 */
export async function forgetPassenger(travelerId: string): Promise<PaxResult> {
  const access = await agencyAccess();
  if (!access.ok || !isId(travelerId)) return notAllowed;
  const { data, error } = await access.context.supabase.rpc("pax_forget_traveler", { target_traveler: travelerId });
  const result = fold(data, error);
  if (!result.ok) return result;
  const backend = service();
  if (backend) await removeForgottenBytes(backend).catch(() => undefined);
  refresh();
  return { ok: true, code: result.code };
}
