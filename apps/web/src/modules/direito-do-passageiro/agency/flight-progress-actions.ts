"use server";

import { agencyAccess } from "@/modules/direito-do-passageiro/agency/facts";
import { type FlightTrip, flightTripsOf } from "@/modules/direito-do-passageiro/agency/flight-progress";

/**
 * What the agency reads of its passengers' flights as they happen (`pax_flight_progress`, migration 0084): the
 * trips ONE follows in the next days, for its home, or every trip of one passenger ONE followed, for their page.
 * Server actions, so the screens read them again while a flight is under way; the database decides who reads what.
 */

export type FlightsRead = { ok: true; days: number; trips: FlightTrip[]; today: string } | { ok: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The day in Brazil's official time, which a step's hour is said against. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function readPartnerFlights(): Promise<FlightsRead> {
  const access = await agencyAccess();
  if (!access.ok) return { ok: false };
  const { data, error } = await access.context.supabase.rpc("pax_flight_progress", {
    target_partner: access.agency.id,
  });
  const read = error ? null : flightTripsOf(data);
  return read ? { ok: true, ...read, today: todayInBrazil() } : { ok: false };
}

export async function readTravelerFlights(travelerId: unknown): Promise<FlightsRead> {
  if (typeof travelerId !== "string" || !UUID.test(travelerId)) return { ok: false };
  const access = await agencyAccess();
  if (!access.ok) return { ok: false };
  const { data, error } = await access.context.supabase.rpc("pax_flight_progress", {
    target_partner: access.agency.id,
    target_traveler: travelerId,
  });
  const read = error ? null : flightTripsOf(data);
  return read ? { ok: true, ...read, today: todayInBrazil() } : { ok: false };
}
