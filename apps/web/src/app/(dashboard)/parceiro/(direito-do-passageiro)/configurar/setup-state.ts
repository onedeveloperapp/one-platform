import "server-only";

import type { AgencySetupState } from "./agency-setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import type { MemberContext } from "@/lib/member/context";
import { type PartnerTeamState, readPartnerTeam } from "@/lib/partners/facts";
import { isPartnerManager } from "@/lib/partners/partner";
import { readClause, readClauseProposal } from "@/modules/direito-do-passageiro/agency/facts";
import type { AgencySetupStep } from "@/modules/direito-do-passageiro/agency/setup";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * Reads the agency's setup: the person's second factor (every write of the agency asks for it), the agency's name
 * and partnership, the clause in force and the one ONE proposes, and the team. Each part that could not be read
 * is its step's to say; the others stand.
 */
export async function loadAgencySetupState(
  context: MemberContext | null,
  step: AgencySetupStep | null,
): Promise<AgencySetupState> {
  const partner = context?.partner ?? null;
  if (!context || !partner) return { kind: "unavailable" };
  const manager = isPartnerManager(partner.role);
  const partnership = partner.links.find((link) => link.module === PASSENGER_MODULE) ?? null;

  const [assurance, cookieStore, clause, proposal, team] = await Promise.all([
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    readClause(context, partner.id).catch(() => ({ ok: false as const })),
    // What ONE proposes and the team are who manages the agency's to act on.
    manager
      ? readClauseProposal(context, partner.id).catch(() => ({ ok: false as const }))
      : Promise.resolve({ ok: false as const }),
    manager ? readPartnerTeam(context).catch((): PartnerTeamState => ({ kind: "error" })) : Promise.resolve(null),
  ]);
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";

  return {
    kind: "ready",
    agency: {
      id: partner.id,
      name: partner.name,
      manager,
      owner: partner.role === "owner",
      answered: partner.setupAnswered,
    },
    firm: partnership?.firm ?? null,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    clause: clause.ok ? clause.value : null,
    clauseRead: clause.ok,
    proposal: proposal.ok ? proposal.value : null,
    team: team?.kind === "ready" ? team : null,
    step,
  };
}
