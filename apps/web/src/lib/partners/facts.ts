import "server-only";

import type { MemberContext } from "@/lib/member/context";
import {
  isPartnerRole,
  type PartnerRole,
  type PartnershipCosts,
  type PartnershipFacts,
  partnershipFactsOf,
} from "@/lib/partners/partner";

/**
 * What the screens of the partners read (migration 0069), under the person's own session: the database decides
 * who reads what, and a read that fails is an error, never an empty list.
 */

export type FirmPartnership = {
  linkId: string;
  partnerId: string;
  partner: string;
  module: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  /** Why it ended, to who manages the firm. */
  endReason: string | null;
  /** What the firm has of it (0075); null when that could not be read. */
  facts: PartnershipFacts | null;
};

export type OpenPartnerInvitation = {
  id: string;
  /** The agency's name a firm's invitation carries; null for a colleague's. */
  partnerName: string | null;
  email: string;
  module: string | null;
  role: string;
  expiresAt: string;
};

export type FirmPartnersState =
  | {
      kind: "ready";
      firm: string;
      manager: boolean;
      partnerships: FirmPartnership[];
      invitations: OpenPartnerInvitation[];
      /** What the partnerships cost the firm today, to who manages it; null otherwise or when unread. */
      costs: PartnershipCosts | null;
      /** The firm's numbers of its partnerships could not be read: the screens say so, never zero. */
      factsFailed: boolean;
    }
  | { kind: "error" }
  | { kind: "unavailable" };

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * The partnerships of the person's firm with what the firm has of each (its cases, and, to who manages it, what
 * each costs today), and, to who manages it, the invitations still open.
 */
export async function readFirmPartners(context: MemberContext | null): Promise<FirmPartnersState> {
  if (!context?.firm) return { kind: "unavailable" };
  const manager = context.firm.role === "owner" || context.firm.role === "admin";
  const [links, invitations, numbers] = await Promise.all([
    context.supabase.rpc("firm_partners", { target_org: context.firm.id }),
    manager
      ? context.supabase
          .from("partner_invitations")
          .select("id, partner_name, email, module_key, role, expires_at")
          .eq("org_id", context.firm.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    context.supabase.rpc("firm_partnership_facts", { target_org: context.firm.id }),
  ]);
  if (links.error || invitations.error) return { kind: "error" };
  const facts = numbers.error ? null : partnershipFactsOf(numbers.data);
  return {
    kind: "ready",
    firm: context.firm.name,
    manager,
    costs: facts?.costs ?? null,
    factsFailed: facts === null,
    partnerships: ((links.data ?? []) as Record<string, unknown>[]).flatMap((row): FirmPartnership[] => {
      const linkId = text(row.link_id);
      const partnerId = text(row.partner_id);
      if (!linkId || !partnerId) return [];
      return [
        {
          linkId,
          partnerId,
          partner: text(row.partner) ?? "",
          module: text(row.module) ?? "",
          status: row.status === "ended" ? "ended" : "active",
          startedAt: text(row.started_at) ?? "",
          endedAt: text(row.ended_at),
          endReason: text(row.end_reason),
          facts: facts?.byLink.get(linkId) ?? null,
        },
      ];
    }),
    invitations: openInvitationsOf(invitations.data),
  };
}

function openInvitationsOf(rows: unknown): OpenPartnerInvitation[] {
  return ((rows ?? []) as Record<string, unknown>[]).flatMap((row): OpenPartnerInvitation[] => {
    const id = text(row.id);
    const email = text(row.email);
    const expiresAt = text(row.expires_at);
    if (!id || !email || !expiresAt) return [];
    return [
      {
        id,
        partnerName: text(row.partner_name),
        email,
        module: text(row.module_key),
        role: text(row.role) ?? "",
        expiresAt,
      },
    ];
  });
}

export type PartnerTeammate = {
  userId: string;
  name: string;
  email: string;
  role: PartnerRole;
  joinedAt: string;
  /** Whether they set a second factor up: known to who manages the partner only. */
  hasSecondFactor: boolean | null;
};

export type PartnerTeamState =
  | { kind: "ready"; me: string; teammates: PartnerTeammate[]; invitations: OpenPartnerInvitation[] }
  | { kind: "error" }
  | { kind: "unavailable" };

/** The partner's team, and the invitations to colleagues still open, to who manages it. */
export async function readPartnerTeam(context: MemberContext | null): Promise<PartnerTeamState> {
  if (!context?.partner) return { kind: "unavailable" };
  const manager = context.partner.role === "owner" || context.partner.role === "admin";
  const [team, invitations] = await Promise.all([
    context.supabase.rpc("partner_team", { target_partner: context.partner.id }),
    manager
      ? context.supabase
          .from("partner_invitations")
          .select("id, partner_name, email, module_key, role, expires_at")
          .eq("partner_id", context.partner.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (team.error || invitations.error) return { kind: "error" };
  return {
    kind: "ready",
    me: context.userId,
    teammates: ((team.data ?? []) as Record<string, unknown>[]).flatMap((row): PartnerTeammate[] => {
      const userId = text(row.user_id);
      if (!userId || !isPartnerRole(row.role)) return [];
      return [
        {
          userId,
          name: text(row.display_name) ?? "",
          email: text(row.email) ?? "",
          role: row.role,
          joinedAt: text(row.joined_at) ?? "",
          hasSecondFactor: typeof row.has_second_factor === "boolean" ? row.has_second_factor : null,
        },
      ];
    }),
    invitations: openInvitationsOf(invitations.data),
  };
}
