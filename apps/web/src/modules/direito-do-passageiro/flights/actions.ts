"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";
import { queueFlightCheck } from "@/modules/direito-do-passageiro/flights/checks-work";
import { flightStatusProvider } from "@/modules/direito-do-passageiro/flights/status";
import { createServiceClient } from "@flyee/auth/service";
import { FLIGHT_CHECK_VERSION } from "@flyee/flights/check";
import { FlightAwareAuthError, FlightAwareQueryError } from "@flyee/flights/providers/flightaware";

/**
 * What a person of a firm does to the check of a leg (migration 0030): ask
 * ANAC's record again, or ask FlightAware about a leg the record cannot
 * answer. The database says whether a person may (their firm, not a support
 * visit, the answers of the day and the wait of the leg); the server asks
 * FlightAware with the platform's key, and the backend records what it
 * answered. A server action is a public endpoint: every id is read again
 * under the caller's session.
 */

export type FlightResult = { ok: true; code: string } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = ["not_allowed_in_support_session", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

/** A person asks ANAC's record again for a leg: one not found, not out yet, or whose check was given up. */
export async function recheckFlight(caseId: string, segmentId: string): Promise<FlightResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(segmentId)) return { ok: false, code: "segment_not_found" };
  const { data, error } = await context.supabase.rpc("request_flight_recheck", { target_segment: segmentId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  await queueFlightCheck();
  revalidatePath(`/casos/${caseId}`);
  return { ok: true, code: "waiting" };
}

/**
 * A person asks FlightAware about a leg. What FlightAware answered is kept as
 * it answered, beside the case's own times: it is a private source, and the
 * screen says so.
 */
export async function lookupFlight(caseId: string, segmentId: string): Promise<FlightResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(segmentId)) return { ok: false, code: "segment_not_found" };
  const provider = flightStatusProvider();
  if (!provider) return { ok: false, code: "lookup_not_configured" };
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }

  const { data, error } = await context.supabase.rpc("begin_flight_lookup", { target_segment: segmentId });
  if (error) return { ok: false, code: raised(error.message) };
  const begun = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    check_id?: string;
    claim?: number;
    flight?: string;
    icao_flights?: string[] | null;
    date?: string;
    origin?: string | null;
    destination?: string | null;
  };
  if (!begun.ok || !begun.flight || !begun.date || !begun.check_id || typeof begun.claim !== "number") {
    return { ok: false, code: String(begun.code ?? "failed") };
  }

  // The answer goes to this lookup, by its id and number: a late one is never kept as another's.
  const record = async (outcome: string, extra: Record<string, unknown> = {}) =>
    service.rpc("record_flight_lookup", {
      target_check: begun.check_id,
      target_claim: begun.claim,
      target_outcome: outcome,
      ...extra,
    });

  // The flight under each ICAO designator of its airline, in order, until one is known (LATAM's "LA" is five
  // airlines, LATAM Brasil first); under its IATA one when the airline is not known.
  const idents = begun.icao_flights && begun.icao_flights.length > 0 ? begun.icao_flights : [null];
  let status = null;
  try {
    for (const ident of idents) {
      status = await provider.getFlightStatus({
        flight: begun.flight,
        date: begun.date,
        icaoFlight: ident,
        origin: begun.origin ?? null,
        destination: begun.destination ?? null,
      });
      if (status) break;
    }
  } catch (lookupError) {
    const code =
      lookupError instanceof FlightAwareAuthError
        ? "lookup_key_refused"
        : lookupError instanceof FlightAwareQueryError
          ? "lookup_refused"
          : "lookup_unavailable";
    await record("unavailable", { target_code: code });
    revalidatePath(`/casos/${caseId}`);
    return { ok: false, code };
  }
  const { data: kept, error: keptError } = status
    ? await record("found", { target_record: status, target_version: FLIGHT_CHECK_VERSION })
    : await record("not_found", { target_version: FLIGHT_CHECK_VERSION });
  revalidatePath(`/casos/${caseId}`);
  if (keptError) return { ok: false, code: "failed" };
  const answer = (kept ?? {}) as { ok?: boolean; code?: string };
  // A leg whose flight changed while FlightAware answered was asked about another flight: nothing is kept.
  if (!answer.ok) return { ok: false, code: answer.code === "not_waiting" ? "flight_changed" : "failed" };
  return { ok: true, code: status ? "found" : "not_found" };
}
