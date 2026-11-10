"use server";

import { getMemberContext } from "@/lib/member/context";

/**
 * What the firm reads of a person who came from an agency (migration 0171): the agency, when the passenger agreed,
 * and the trips ONE follows of them for the agency, only while their yes passes the data to the firm.
 */
export type PersonAgency = {
  agency: string;
  leadAt: string | null;
  trips: {
    id: string;
    status: string;
    caseId: string | null;
    legs: {
      position: number;
      flight: string;
      origin: string;
      destination: string;
      departure: string;
      status: string;
    }[];
  }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The agencies a person came from, with their trips; null when they could not be read. */
export async function personAgency(personId: string): Promise<PersonAgency[] | null> {
  const context = await getMemberContext();
  if (!context?.firm || !UUID.test(String(personId ?? ""))) return null;
  const { data, error } = await context.supabase.rpc("firm_person_agency", { target_person: personId });
  if (error) return null;
  const answer = (data ?? {}) as { ok?: boolean; agencies?: unknown };
  if (!answer.ok || !Array.isArray(answer.agencies)) return answer.ok === false ? [] : null;
  return answer.agencies.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    return {
      agency: text(row.agency),
      leadAt: text(row.lead_at) || null,
      trips: (Array.isArray(row.trips) ? row.trips : []).map((rawTrip) => {
        const trip = (rawTrip ?? {}) as Record<string, unknown>;
        return {
          id: text(trip.id),
          status: text(trip.status) || "watching",
          caseId: text(trip.case_id) || null,
          legs: (Array.isArray(trip.legs) ? trip.legs : []).map((rawLeg) => {
            const leg = (rawLeg ?? {}) as Record<string, unknown>;
            return {
              position: Number(leg.position) || 0,
              flight: text(leg.flight),
              origin: text(leg.origin),
              destination: text(leg.destination),
              departure: text(leg.departure),
              status: text(leg.status) || "scheduled",
            };
          }),
        };
      }),
    };
  });
}
