import "server-only";

import type { SetupState } from "./setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { cloudSigningOffered } from "@/lib/cases/filing-facts";
import { isManager, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import type { SetupStepKey } from "@/lib/firm/setup-steps";
import { loadSetupPapers } from "@/lib/library/facts";
import { readPaperImports } from "@/lib/library/import-read";
import type { MemberContext } from "@/lib/member/context";
import { nextModuleSetup } from "@/lib/modules/module-setups";
import { readModuleSetups } from "@/lib/modules/module-setups-read";
import type { ConnectionsState } from "@/lib/whatsapp/connections";
import { loadConnections } from "@/lib/whatsapp/connections-read";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the firm's setup shows (migrations 0044, 0052, 0054, 0056), read under
 * the person's own session: their registrations at the bar and whether they
 * sign what ONE prepares, what the firm answered, which paper ONE sends
 * clients to sign of each kind, and the firm's connections as their own
 * screen reads them (the signature account, the test chat, the number), so
 * every step acts where it is; and the setup of the first module the firm
 * contracted and never answered (0081), which the core's finish opens. Read by `/configurar` and by the home, which asks the questions itself
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
    papers,
    connections,
    decides,
    paperImports,
    moduleSetups,
    declaredCpf,
    cloudSigning,
  ] = await Promise.all([
    context.supabase.from("oab_registrations").select("id, uf, number, kind").eq("user_id", context.userId),
    context.supabase.from("firm_signers").select("user_id").eq("org_id", firm.id),
    context.supabase.from("organizations").select("works_alone, setup_answered_at").eq("id", firm.id).maybeSingle(),
    context.supabase.from("wa_numbers").select("id").eq("org_id", firm.id).eq("status", "active").limit(1),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    // Each of these is its step's: one that could not be read says so there, and the other steps stand.
    loadSetupPapers(context.supabase, firm.id, context.profile.timezone).catch(() => null),
    loadConnections(null).catch((): ConnectionsState => ({ kind: "error" })),
    // Who decides for the firm what a partner decides (0078): a partner, or, with no partner, who manages it.
    context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
    // What ONE does with the document the firm sent as each paper (0079): read by who writes the models only.
    readPaperImports(context.supabase, firm.id).catch(() => ({ procuracao: null, contrato: null })),
    // The modules' own setups: a read that fails opens the home at the finish, never a setup not owed.
    readModuleSetups(context).catch(() => null),
    // The CPF of who answers, for the signature in the cloud (0041), asked where a provider can be used here. A read
    // that fails asks nothing: the team's card asks it when a lawsuit needs it.
    context.supabase.from("lawyer_cpfs").select("user_id").eq("user_id", context.userId).maybeSingle(),
    cloudSigningOffered(context.supabase).catch(() => false),
  ]);
  if (registrations.error || signers.error || organization.error || !organization.data) return { kind: "error" };

  const signing = ((signers.data ?? []) as { user_id: string }[]).map((row) => row.user_id);
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  const org = organization.data as { works_alone: boolean | null; setup_answered_at: string | null };

  return {
    kind: "ready",
    userId: context.userId,
    orgId: firm.id,
    firmName: firm.name,
    firmFunction: firm.firmFunction,
    decidesForFirm: decides.error ? false : decides.data === true,
    registrations: ((registrations.data ?? []) as OabRegistration[]).filter((registration) =>
      (OAB_STATES as readonly string[]).includes(registration.uf),
    ),
    signs: signing.includes(context.userId),
    asksCpf: cloudSigning && !declaredCpf.error && declaredCpf.data === null,
    worksAlone: org.works_alone,
    answered: org.setup_answered_at !== null,
    whatsapp: !numbers.error && (numbers.data ?? []).length > 0,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    isOwner: firm.role === "owner",
    papers,
    paperImports,
    connections,
    nextSetup: (() => {
      const next = nextModuleSetup(moduleSetups);
      return next ? { href: next.href, name: next.name } : null;
    })(),
    step,
  };
}
