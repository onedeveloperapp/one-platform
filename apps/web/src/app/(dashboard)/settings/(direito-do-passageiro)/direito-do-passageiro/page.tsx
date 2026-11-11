import PassengerSettingsView, { type PassengerSettingsState } from "./passenger-settings-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { claimDefaultsOf } from "@/lib/firm/autonomy";
import { getMemberContext } from "@/lib/member/context";
import { caseKindsOf } from "@/lib/modules/registry";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-module-settings") };
}

/**
 * /settings/direito-do-passageiro: what only the passenger module's cases read, set by the firm at any time after the
 * module's setup asked it once (0081): the Valor da Causa Pedido of each kind of air-passenger problem (0052, 0064),
 * the value the firm settles for at least (0187) and the words of the clause its partner agencies register. They were
 * in "O que o ONE decide" and in the module's area; now the module has one page of its own, under its name in the
 * settings menu, beside its partner agencies. Anybody of the firm reads it; who decides for the firm changes it, with
 * the second factor. Read under the person's own session.
 */
async function loadPassengerSettings(): Promise<PassengerSettingsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!context.modules.includes(PASSENGER_MODULE)) return { kind: "not-contracted" };
  const firm = context.firm;
  const module = (context.catalog ?? []).find((entry) => entry.key === PASSENGER_MODULE) ?? null;
  const [assurance, cookieStore, decides, defaults, clause, proposal] = await Promise.all([
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
  ]);
  const kinds = new Set(caseKindsOf(PASSENGER_MODULE).map((kind) => kind.key));
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    moduleName: module?.name ?? null,
    decides: !decides.error && decides.data === true,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    // Only this module's kinds of problem: another module's values are its own settings'.
    claimDefaults: defaults.error ? null : claimDefaultsOf(defaults.data).filter((row) => kinds.has(row.incident)),
    clause:
      clause.error || !clause.data ? null : { version: Number(clause.data.version), body: String(clause.data.body) },
    clauseRead: !clause.error,
    proposal: !proposal.error && typeof proposal.data === "string" ? proposal.data : null,
  };
}

export default async function PassengerSettingsPage() {
  return <PassengerSettingsView state={await loadPassengerSettings()} />;
}
