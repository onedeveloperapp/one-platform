import "server-only";

import type { SetupState } from "./setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { isManager, OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import type { MemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What the first questions of a firm show (migration 0044), read under the
 * person's own session: their registrations at the bar, whether they sign
 * what ONE prepares, what the firm answered, and whether its WhatsApp is
 * connected. Read by `/configurar` and by the home, which asks the questions
 * itself while they were never answered: a redirect between the two would go
 * through the client router, and nothing is gained by it.
 */
export async function loadSetupState(context: MemberContext | null): Promise<SetupState> {
  if (!context) return { kind: "unavailable" };
  const firm = context.firm;
  if (!firm || !isManager(firm.role)) return { kind: "not-manager" };

  const [registrations, signers, organization, numbers, assurance, cookieStore] = await Promise.all([
    context.supabase.from("oab_registrations").select("id, uf, number, kind").eq("user_id", context.userId),
    context.supabase.from("firm_signers").select("user_id").eq("org_id", firm.id),
    context.supabase.from("organizations").select("works_alone, setup_answered_at").eq("id", firm.id).maybeSingle(),
    context.supabase.from("wa_numbers").select("id").eq("org_id", firm.id).eq("status", "active").limit(1),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
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
  };
}
