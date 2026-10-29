import "server-only";

import { getMemberContext, type MemberContext } from "@/lib/member/context";
import { isPartnerManager, type PartnerLink } from "@/lib/partners/partner";
import {
  type PaxDetail,
  paxDetailOf,
  type PaxFilter,
  type PaxOverview,
  paxOverviewOf,
  type PaxPage,
  paxPageOf,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";

/**
 * What the agency's screens read (migration 0070): every read is a function of the database that checks the
 * person is of the partner, under the person's own session. A read that fails is said as failed, never as a list
 * with nothing in it.
 */

/** The person looking, their agency and its partnership in the passenger module, or why there is none. */
export type AgencyAccess =
  | {
      ok: true;
      context: MemberContext;
      partnership: PartnerLink;
      agency: { id: string; name: string; manager: boolean };
    }
  | { ok: false; code: "not_a_partner" | "no_partnership" };

export async function agencyAccess(): Promise<AgencyAccess> {
  const context = await getMemberContext();
  const partner = context?.partner ?? null;
  if (!context || !partner) return { ok: false, code: "not_a_partner" };
  const partnership = partner.links.find((link) => link.module === PASSENGER_MODULE);
  if (!partnership) return { ok: false, code: "no_partnership" };
  return {
    ok: true,
    context,
    partnership,
    agency: { id: partner.id, name: partner.name, manager: isPartnerManager(partner.role) },
  };
}

export type Read<T> = { ok: true; value: T } | { ok: false };

export async function readOverview(context: MemberContext, partnershipId: string): Promise<Read<PaxOverview>> {
  const { data, error } = await context.supabase.rpc("pax_overview", { target_partnership: partnershipId });
  if (error) return { ok: false };
  return { ok: true, value: paxOverviewOf(data) };
}

export async function readTravelers(
  context: MemberContext,
  partnershipId: string,
  query: { search: string; filter: PaxFilter; offset: number; limit: number },
): Promise<Read<PaxPage>> {
  const { data, error } = await context.supabase.rpc("pax_travelers_page", {
    target_partnership: partnershipId,
    target_search: query.search.trim() || null,
    target_filter: query.filter,
    target_limit: query.limit,
    target_offset: Math.max(0, query.offset),
  });
  if (error) return { ok: false };
  return { ok: true, value: paxPageOf(data) };
}

export async function readTraveler(context: MemberContext, travelerId: string): Promise<Read<PaxDetail> | null> {
  const { data, error } = await context.supabase.rpc("pax_traveler_detail", { target_traveler: travelerId });
  if (error) return /not_authorized/.test(error.message) ? null : { ok: false };
  const detail = paxDetailOf(data);
  return detail ? { ok: true, value: detail } : null;
}

/** The clause of the agency's contract in force, which the passenger reads on the link after ONE's words. */
export async function readClause(
  context: MemberContext,
  agencyId: string,
): Promise<Read<{ version: number; body: string } | null>> {
  const { data, error } = await context.supabase
    .from("pax_consent_terms")
    .select("version, body")
    .eq("partner_id", agencyId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false };
  return { ok: true, value: data ? { version: Number(data.version), body: String(data.body) } : null };
}
