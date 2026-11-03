import "server-only";

import type { PassengerSetupState, PassengerSetupStep } from "./passenger-setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { claimDefaultsOf } from "@/lib/firm/autonomy";
import { isManager } from "@/lib/firm/roles";
import type { MemberContext } from "@/lib/member/context";
import { nextModuleSetup } from "@/lib/modules/module-setups";
import { readModuleSetups } from "@/lib/modules/module-setups-read";
import { readFirmPartners } from "@/lib/partners/facts";
import type { ConnectionsState } from "@/lib/whatsapp/connections";
import { loadConnections } from "@/lib/whatsapp/connections-read";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the passenger module's setup shows (migration 0081), read under the person's own session: the module as
 * the catalog names it and where it stands among the firm's module setups, the Valor da Causa Pedido of each kind
 * of problem, the words of the clause the firm gives its agencies (or ONE's proposal written for the firm), its
 * partner agencies and the channel the partnership needs, and the modules the firm did not contract, shown
 * disabled. Each part that could not be read is its step's to say; the others stand.
 */
export async function loadPassengerSetupState(
  context: MemberContext | null,
  step: PassengerSetupStep | null,
): Promise<PassengerSetupState> {
  const firm = context?.firm ?? null;
  if (!context || !firm) return { kind: "unavailable" };
  if (!isManager(firm.role)) return { kind: "not-manager" };
  const module = (context.catalog ?? []).find((entry) => entry.key === PASSENGER_MODULE) ?? null;
  if (!module || !context.modules.includes(PASSENGER_MODULE)) return { kind: "not-contracted" };

  const [assurance, cookieStore, decides, defaults, clause, proposal, partners, connections, setups] =
    await Promise.all([
      context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      cookies(),
      context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
      context.supabase.from("firm_claim_defaults").select("incident, cents").eq("org_id", firm.id),
      context.supabase
        .from("pax_firm_clauses")
        .select("version, body")
        .eq("org_id", firm.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase.rpc("pax_firm_clause_proposal", { target_org: firm.id }),
      readFirmPartners(context).catch(() => null),
      loadConnections(null).catch((): ConnectionsState => ({ kind: "error" })),
      readModuleSetups(context).catch(() => null),
    ]);

  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  const mine = setups?.find((setup) => setup.key === PASSENGER_MODULE) ?? null;
  const index = setups ? setups.findIndex((setup) => setup.key === PASSENGER_MODULE) : -1;
  const next = nextModuleSetup(setups, PASSENGER_MODULE);
  const others = (context.catalog ?? [])
    .filter((entry) => entry.key !== PASSENGER_MODULE && !context.modules.includes(entry.key))
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      icon: entry.icon,
      tone: entry.tone,
      soon: entry.status === "coming_soon",
    }));

  return {
    kind: "ready",
    firmName: firm.name,
    module: { key: module.key, name: module.name, icon: module.icon, tone: module.tone },
    position: { index: index >= 0 ? index + 1 : 1, total: Math.max(setups?.length ?? 1, 1) },
    next: next ? { href: next.href, name: next.name } : null,
    answered: mine?.answered ?? false,
    decidesForFirm: decides.error ? false : decides.data === true,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    claimDefaults: defaults.error ? null : claimDefaultsOf(defaults.data),
    clause:
      clause.error || !clause.data ? null : { version: Number(clause.data.version), body: String(clause.data.body) },
    clauseRead: !clause.error,
    proposal: !proposal.error && typeof proposal.data === "string" ? proposal.data : null,
    partners: partners?.kind === "ready" ? partners : null,
    connections,
    others,
    step,
  };
}
