import "server-only";

import type { PersonSetupState } from "./person-setup-view";
import { cookies } from "next/headers";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { cloudSigningOffered } from "@/lib/cases/filing-facts";
import type { PersonSetupStep } from "@/lib/firm/person-setup";
import { OAB_STATES, type OabRegistration } from "@/lib/firm/roles";
import type { MemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/**
 * What a person's own setup shows (2026-11-03), read under their session: their registrations at the bar and the
 * state of their second factor. Read by `/configurar` for anybody who does not manage the firm, and by the home,
 * which asks it in place while something of it is owed and the person never answered it.
 */
export async function loadPersonSetupState(
  context: MemberContext | null,
  step: PersonSetupStep | null = null,
): Promise<PersonSetupState> {
  const firm = context?.firm ?? null;
  if (!context || !firm) return { kind: "unavailable" };
  const [registrations, assurance, cookieStore, declaredCpf, cloudSigning, profile] = await Promise.all([
    context.supabase.from("oab_registrations").select("id, uf, number, kind").eq("user_id", context.userId),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    // The CPF for the signature in the cloud (0041), asked where a provider can be used here; a read that fails asks
    // nothing (the team's card asks it when a lawsuit needs it).
    context.supabase.from("lawyer_cpfs").select("user_id").eq("user_id", context.userId).maybeSingle(),
    cloudSigningOffered(context.supabase).catch(() => false),
    // Their own WhatsApp (0187), which everybody gives (the owner, 2026-11-14).
    context.supabase.from("profiles").select("whatsapp").eq("id", context.userId).maybeSingle(),
  ]);
  if (registrations.error || profile.error) return { kind: "error" };
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    userId: context.userId,
    orgId: firm.id,
    firmName: firm.name,
    firmFunction: firm.firmFunction,
    registrations: ((registrations.data ?? []) as OabRegistration[]).filter((registration) =>
      (OAB_STATES as readonly string[]).includes(registration.uf),
    ),
    asksCpf: cloudSigning && !declaredCpf.error && declaredCpf.data === null,
    whatsapp: (profile.data as { whatsapp?: string | null } | null)?.whatsapp ?? null,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    step,
  };
}
