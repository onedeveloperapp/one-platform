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

/** The words an agency's setup offers it for its clause, and whose they are. */
export type ClauseOffer = { text: string; source: "firm" | "one"; firm: string | null };

/**
 * The words the agency is offered for its clause (migrations 0080 and 0081): the words its firm gave, in force,
 * when the firm gave any, else ONE's proposal with the agency's and the firm's names, for somebody of the agency to
 * read, change and register. Null when there are none.
 */
export async function readClauseOffer(context: MemberContext, agencyId: string): Promise<Read<ClauseOffer | null>> {
  const { data, error } = await context.supabase.rpc("pax_clause_offer", { target_partner: agencyId });
  if (error) return { ok: false };
  const answer = (data ?? {}) as { text?: unknown; source?: unknown; firm?: unknown };
  const text = typeof answer.text === "string" && answer.text.trim().length > 0 ? answer.text : null;
  if (!text) return { ok: true, value: null };
  return {
    ok: true,
    value: {
      text,
      source: answer.source === "firm" ? "firm" : "one",
      firm: typeof answer.firm === "string" ? answer.firm : null,
    },
  };
}

/** A key of the partnership for the agency's system (migration 0073), as the agency reads it: never the key. */
export type ApiKeyRow = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export async function readApiKeys(context: MemberContext, partnershipId: string): Promise<Read<ApiKeyRow[]>> {
  const { data, error } = await context.supabase
    .from("partner_api_keys")
    .select("id, label, key_prefix, created_at, last_used_at, revoked_at")
    .eq("partnership_id", partnershipId)
    .order("created_at", { ascending: false });
  if (error) return { ok: false };
  return {
    ok: true,
    value: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      label: String(row.label ?? ""),
      prefix: String(row.key_prefix ?? ""),
      createdAt: String(row.created_at ?? ""),
      lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    })),
  };
}
