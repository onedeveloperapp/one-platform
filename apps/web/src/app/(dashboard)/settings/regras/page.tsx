import RulesView, { type RulesState } from "./rules-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { readAgenda } from "@/lib/agenda/actions";
import type { SecondFactorState } from "@/lib/ai/approvals";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-rules") };
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * /settings/regras: the firm's rules of the cases, which ONE follows in every case of every module: who signs what ONE
 * prepares (0052), whether a bill in somebody else's name is accepted with the client's declaration (0123), and the
 * internal deadline (0132, 0167). They were in "O que o ONE decide" and in the person's panel of the agenda; none is a
 * decision of ONE's, and all are the firm's. Read under the person's own session; each part that could not be read is
 * its card's to say.
 */
async function loadRules(): Promise<RulesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const firm = context.firm;
  const [team, signers, assurance, cookieStore, decides, policy, month, agenda] = await Promise.all([
    context.supabase.rpc("firm_team", { target_org: firm.id }),
    context.supabase.from("firm_signers").select("user_id").eq("org_id", firm.id),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    // Who decides for the firm what a partner decides (0078): a partner, or, with no partner, who manages it.
    context.supabase.rpc("decides_for_firm", { target_org: firm.id }),
    // Whether the firm accepts a bill in somebody else's name (0123), and the month's packages that carry one.
    context.supabase.from("organizations").select("third_party_bill").eq("id", firm.id).maybeSingle(),
    context.supabase.rpc("firm_third_party_bills", { target_org: firm.id }),
    // The internal deadline and who may set it, as the agenda reads them (0132, 0167).
    readAgenda(today(), today(), null).catch(() => null),
  ]);
  const counted = (month.error ? null : month.data) as { packages?: unknown; third_party?: unknown } | null;
  const signing = new Set(((signers.data ?? []) as { user_id: string }[]).map((row) => row.user_id));
  const teamRows = (team.error ? [] : (team.data ?? [])) as {
    user_id: string;
    display_name: string | null;
    email: string | null;
    firm_function: string;
    oab: { uf?: unknown }[] | null;
  }[];
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    decides: !decides.error && decides.data === true,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    signers:
      team.error || signers.error
        ? null
        : teamRows
            .filter((person) => person.firm_function === "socio" || person.firm_function === "advogado")
            .map((person) => ({
              userId: person.user_id,
              name: person.display_name?.trim() || person.email?.split("@")[0] || "",
              states: (person.oab ?? []).flatMap((registration) =>
                typeof registration.uf === "string" ? [registration.uf] : [],
              ),
              signs: signing.has(person.user_id),
            })),
    thirdParty:
      policy.error || !policy.data
        ? null
        : {
            policy: (policy.data as { third_party_bill?: string }).third_party_bill === "refuse" ? "refuse" : "accept",
            month:
              counted && typeof counted.packages === "number" && typeof counted.third_party === "number"
                ? { packages: counted.packages, thirdParty: counted.third_party }
                : null,
          },
    internal:
      agenda && agenda.ok
        ? {
            days: agenda.internalDays,
            byAct: agenda.internalByAct,
            acts: agenda.acts,
            sets: agenda.me.setsInternalDays,
          }
        : null,
  };
}

export default async function RulesPage() {
  return <RulesView state={await loadRules()} />;
}
