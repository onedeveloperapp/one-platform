import "server-only";

import type { SetupState } from "./setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { claimDefaultsOf } from "@/lib/firm/autonomy";
import { isManager, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import type { SetupStepKey } from "@/lib/firm/setup-steps";
import { loadSetupPapers } from "@/lib/library/facts";
import type { MemberContext } from "@/lib/member/context";
import { moduleOf } from "@/lib/modules/registry";
import { readFirmPartners } from "@/lib/partners/facts";
import type { ConnectionsState } from "@/lib/whatsapp/connections";
import { loadConnections } from "@/lib/whatsapp/connections-read";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the firm's setup shows (migrations 0044, 0052, 0054, 0056), read under
 * the person's own session: their registrations at the bar and whether they
 * sign what ONE prepares, the Valor da Causa Pedido of each kind of problem
 * the firm gives one for, what the firm answered, which paper ONE sends clients to sign of
 * each kind, and the firm's connections as their own screen reads them (the
 * signature account, the test chat, the number), the modules the firm
 * contracted (0075) and its partner agencies (0069), so every step acts where it
 * is. Read by `/configurar` and by the home, which asks the questions itself
 * while they were never answered: a redirect between the two would go
 * through the client router, and nothing is gained by it.
 */
export async function loadSetupState(
  context: MemberContext | null,
  step: SetupStepKey | null = null,
): Promise<SetupState> {
  if (!context) return { kind: "unavailable" };
  const firm = context.firm;
  if (!firm || !isManager(firm.role)) return { kind: "not-manager" };

  const [
    registrations,
    signers,
    organization,
    numbers,
    assurance,
    cookieStore,
    defaults,
    papers,
    connections,
    partners,
    decides,
  ] = await Promise.all([
    context.supabase.from("oab_registrations").select("id, uf, number, kind").eq("user_id", context.userId),
    context.supabase.from("firm_signers").select("user_id").eq("org_id", firm.id),
    context.supabase.from("organizations").select("works_alone, setup_answered_at").eq("id", firm.id).maybeSingle(),
    context.supabase.from("wa_numbers").select("id").eq("org_id", firm.id).eq("status", "active").limit(1),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    context.supabase.from("firm_claim_defaults").select("incident, cents").eq("org_id", firm.id),
    // Each of these is its step's: one that could not be read says so there, and the other steps stand.
    loadSetupPapers(context.supabase, firm.id, context.profile.timezone).catch(() => null),
    loadConnections(null).catch((): ConnectionsState => ({ kind: "error" })),
    readFirmPartners(context).catch(() => null),
    // Who decides for the firm what a partner decides (0078): a partner, or, with no partner, who manages it.
    context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
  ]);
  if (registrations.error || signers.error || organization.error || !organization.data) return { kind: "error" };

  const signing = ((signers.data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  const org = organization.data as { works_alone: boolean | null; setup_answered_at: string | null };

  return {
    kind: "ready",
    userId: context.userId,
    firmName: firm.name,
    firmFunction: firm.firmFunction,
    decidesForFirm: decides.error ? false : decides.data === true,
    registrations: ((registrations.data ?? []) as OabRegistration[]).filter((registration) =>
      (OAB_STATES as readonly string[]).includes(registration.uf),
    ),
    signs: signing.includes(context.userId),
    worksAlone: org.works_alone,
    answered: org.setup_answered_at !== null,
    whatsapp: !numbers.error && (numbers.data ?? []).length > 0,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    isOwner: firm.role === "owner",
    claimDefaults: defaults.error ? null : claimDefaultsOf(defaults.data),
    papers,
    connections,
    // The firm's module whose partner it invites here: the passenger module's travel agency.
    agencyModule: context.modules.find((key) => (moduleOf(key)?.partnerArea.length ?? 0) > 0) ?? null,
    partners: partners?.kind === "ready" ? partners : null,
    step,
  };
}
