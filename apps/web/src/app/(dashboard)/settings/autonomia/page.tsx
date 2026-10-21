import AutonomyView, { type AutonomyState } from "./autonomy-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { firmAutonomyOf } from "@/lib/firm/autonomy";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-autonomy") };
}

/**
 * /settings/autonomia: what the firm lets ONE decide alone (migration 0016).
 * Anybody of the firm reads how each decision is taken now; a partner
 * changes it with the second factor. Read under the person's own session.
 */
async function loadAutonomy(): Promise<AutonomyState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const firm = context.firm;
  const [autonomy, team, signers, assurance, cookieStore] = await Promise.all([
    context.supabase.rpc("firm_autonomy", { target_org: firm.id }),
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    context.supabase.from("firm_signers").select("user_id").eq("org_id", firm.id),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
  ]);
  const decisions = autonomy.error ? null : firmAutonomyOf(autonomy.data);
  if (!decisions) return { kind: "error" };
  const signing = new Set(((signers.data ?? []) as { user_id: string }[]).map((row) => row.user_id));
  // Who chose is said by name when the team could be read; the choices are what the page is for, and who
  // signs is said apart (its card says it could not be read).
  const teamRows = (team.error ? [] : (team.data ?? [])) as {
    user_id: string;
    display_name: string | null;
    email: string | null;
    firm_function: string;
    oab: { uf?: unknown }[] | null;
  }[];
  const names = new Map(
    teamRows.map((person) => [person.user_id, person.display_name?.trim() || person.email?.split("@")[0] || ""]),
  );
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    partner: firm.firmFunction === "socio",
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    signers:
      team.error || signers.error
        ? null
        : teamRows
            .filter((person) => person.firm_function === "socio" || person.firm_function === "advogado")
            .map((person) => ({
              userId: person.user_id,
              name: names.get(person.user_id) || "",
              states: (person.oab ?? []).flatMap((registration) =>
                typeof registration.uf === "string" ? [registration.uf] : [],
              ),
              signs: signing.has(person.user_id),
            })),
    decisions: decisions.map((decision) => ({
      ...decision,
      changedByName: decision.changedBy ? names.get(decision.changedBy) || null : null,
      changedLabel: decision.changedAt ? momentLabel(decision.changedAt, context.profile.timezone) : null,
    })),
  };
}

export default async function AutonomyPage() {
  return <AutonomyView state={await loadAutonomy()} />;
}
