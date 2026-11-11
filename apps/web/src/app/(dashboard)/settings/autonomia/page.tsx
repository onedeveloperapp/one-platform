import AutonomyView, { type AutonomyState } from "./autonomy-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { firmAutonomyOf } from "@/lib/firm/autonomy";
import { getMemberContext } from "@/lib/member/context";
import { isPublicationCategory } from "@/lib/publications/publications";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-autonomy") };
}

/**
 * /settings/autonomia: what the firm lets ONE decide alone (migration 0016), grouped by the stage of the case, and,
 * inside the triage of the publications, whether the firm lets ONE's reading be the triage (0035). Anybody of the
 * firm reads how each decision is taken now; a partner changes it with the second factor. Read under the person's
 * own session.
 */
async function loadAutonomy(): Promise<AutonomyState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const firm = context.firm;
  const [autonomy, team, assurance, cookieStore, decides, policies, triage] = await Promise.all([
    context.supabase.rpc("firm_autonomy", { target_org: firm.id }),
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    // Who decides for the firm what a partner decides (0078): a partner, or, with no partner, who manages it.
    context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
    // Which categories ONE's reading is the triage of (0035), and whether the firm lets it be.
    context.supabase.from("publication_triage_policies").select("category, mode, sample_percent").eq("mode", "sampled"),
    context.supabase.from("organizations").select("publication_ai_triage").eq("id", firm.id).maybeSingle(),
  ]);
  const decisions = autonomy.error ? null : firmAutonomyOf(autonomy.data);
  if (!decisions) return { kind: "error" };
  // Who chose is said by name when the team could be read; the choices are what the page is for.
  const teamRows = (team.error ? [] : (team.data ?? [])) as {
    user_id: string;
    display_name: string | null;
    email: string | null;
  }[];
  const names = new Map(
    teamRows.map((person) => [person.user_id, person.display_name?.trim() || person.email?.split("@")[0] || ""]),
  );
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    partner: !decides.error && decides.data === true,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    aiTriage:
      policies.error || triage.error
        ? null
        : {
            // Off until a partner turns it on: only a firm that said yes lets the AI's answer be its triage.
            firmAllows: (triage.data as { publication_ai_triage?: unknown } | null)?.publication_ai_triage === true,
            sampled: ((policies.data ?? []) as { category: string; sample_percent: number }[]).flatMap((policy) =>
              isPublicationCategory(policy.category)
                ? [{ category: policy.category, samplePercent: policy.sample_percent }]
                : [],
            ),
          },
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
