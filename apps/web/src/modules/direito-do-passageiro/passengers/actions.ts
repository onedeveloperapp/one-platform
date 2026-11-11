"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { queueWelcome } from "@/modules/direito-do-passageiro/flight-alerts/welcome-work";
import type { PassengerLeg } from "@/modules/direito-do-passageiro/passengers/passengers";

/**
 * The firm's own passengers (migration 0170): a person of the firm with no case, and the trip ONE follows of them with
 * the agreement the firm recorded; the documents the person sent for it stay with the trip until the passenger's yes
 * opens the case, which takes them. Every write is a function of the database, which decides who may.
 */

export type PassengerResult =
  | { ok: true; personId: string; reused: boolean; test: boolean }
  | { ok: false; code: string; field?: string | null; leg?: number | null; personId?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const DOC_KINDS = ["identity", "address_proof", "ticket", "boarding_pass"];

const raised = (message: string | null | undefined): string =>
  (message ?? "").includes("not_allowed_in_support_session") ? "not_allowed_in_support_session" : "failed";

function refresh(personId: string | null) {
  revalidatePath("/pessoas");
  if (personId) revalidatePath(`/pessoas/${personId}`);
}

/**
 * Registers a passenger of the firm (or takes the person given, or the one the firm has with that CPF) and has ONE
 * follow their trip. Answers the person the trip is of.
 */
export async function registerPassenger(input: {
  personId?: string | null;
  person?: Record<string, string | null>;
  legs: PassengerLeg[];
  how: string;
  documents: { fileId: string; kind: string }[];
}): Promise<PassengerResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  let personId = isId(input?.personId) ? input.personId : null;
  let reused = Boolean(personId);
  if (!personId) {
    // ONE tells the passenger on WhatsApp: a person with none is not written for a trip that cannot be followed.
    const phone = String(input?.person?.phone ?? "").replace(/\D/g, "");
    if (phone.length < 10) return { ok: false, code: "no_phone", field: "phone" };
    const { data, error } = await context.supabase.rpc("firm_save_person", {
      target_org: context.firm.id,
      target_fields: input?.person ?? {},
    });
    if (error) return { ok: false, code: raised(error.message) };
    const answer = (data ?? {}) as { ok?: boolean; code?: string; field?: string; person_id?: string };
    if (answer.code === "cpf_taken" && isId(answer.person_id)) {
      // The CPF is a person the firm has: the trip is theirs.
      personId = answer.person_id;
      reused = true;
    } else if (!answer.ok || !isId(answer.person_id)) {
      return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
    } else {
      personId = answer.person_id;
    }
  }
  const documents = (Array.isArray(input?.documents) ? input.documents : [])
    .filter((item) => isId(item?.fileId) && DOC_KINDS.includes(String(item?.kind)))
    .map((item) => ({ file_id: item.fileId, kind: item.kind }));
  const { data, error } = await context.supabase.rpc("firm_follow_trip", {
    target_person: personId,
    target_legs: Array.isArray(input?.legs) ? input.legs : [],
    target_how: String(input?.how ?? ""),
    target_documents: documents,
  });
  refresh(personId);
  if (error) return { ok: false, code: raised(error.message), personId };
  const answer = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    field?: string;
    leg?: number;
    test?: boolean;
    trip_id?: string;
  };
  if (!answer.ok) {
    return {
      ok: false,
      code: String(answer.code ?? "failed"),
      field: answer.field ?? null,
      leg: typeof answer.leg === "number" ? answer.leg : null,
      personId,
    };
  }
  // 0174: the passenger the firm just registered is welcomed in the firm's name, once.
  if (typeof answer.trip_id === "string") queueWelcome(answer.trip_id);
  return { ok: true, personId, reused, test: answer.test === true };
}

/** ONE stops following a trip of a person of the firm. */
export async function stopFollowing(input: {
  tripId: string;
  personId: string;
}): Promise<{ ok: boolean; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.tripId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("firm_stop_trip", { target_trip: input.tripId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  refresh(isId(input.personId) ? input.personId : null);
  return { ok: answer.ok === true, code: String(answer.code ?? "failed") };
}

export type PersonTrip = {
  id: string;
  status: "watching" | "alerted" | "case_opened" | "declined" | "stopped";
  test: boolean;
  agreedAt: string;
  caseId: string | null;
  documents: number;
  /** A trip that became a case whose other journey ONE still follows (0172). */
  restFollowed: boolean;
  legs: {
    position: number;
    flight: string;
    origin: string;
    destination: string;
    departure: string;
    arrival: string;
    status: string;
  }[];
};

/** The trips ONE follows, or followed, of a person of the firm: the latest first. Null when they could not be read. */
export async function personTrips(personId: string): Promise<PersonTrip[] | null> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(personId)) return null;
  const { data, error } = await context.supabase
    .from("tracked_trips")
    .select(
      "id, status, is_test, consent_at, case_id, rest_closed, tracked_legs(position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local, status, case_id), tracked_trip_documents(id)",
    )
    .eq("org_id", context.firm.id)
    .eq("person_id", personId)
    .order("consent_at", { ascending: false })
    .limit(20);
  if (error) return null;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const legs = (Array.isArray(row.tracked_legs) ? row.tracked_legs : []) as Record<string, unknown>[];
    const documents = Array.isArray(row.tracked_trip_documents) ? row.tracked_trip_documents.length : 0;
    return {
      id: String(row.id),
      status: row.status as PersonTrip["status"],
      test: row.is_test === true,
      agreedAt: String(row.consent_at ?? ""),
      caseId: typeof row.case_id === "string" ? row.case_id : null,
      documents,
      restFollowed:
        row.status === "case_opened" && row.rest_closed !== true && legs.some((leg) => leg.case_id === null),
      legs: legs
        .map((leg) => ({
          position: Number(leg.position),
          flight: String(leg.flight_number ?? ""),
          origin: String(leg.origin_iata ?? ""),
          destination: String(leg.destination_iata ?? ""),
          departure: String(leg.scheduled_departure_local ?? "").slice(0, 16),
          arrival: String(leg.scheduled_arrival_local ?? "").slice(0, 16),
          status: String(leg.status ?? "scheduled"),
        }))
        .sort((a, b) => a.position - b.position),
    };
  });
}

/** The words of the agreement the firm records (`platform_settings` `firm_trip_consent`), as the database keeps them. */
export async function passengerConsentWords(): Promise<string | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "firm_trip_consent")
    .maybeSingle();
  if (error || !data) return null;
  const text = (data.value as { text?: unknown } | null)?.text;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}
