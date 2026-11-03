import AgencySetupView from "./agency-setup-view";
import { loadAgencySetupState } from "./setup-state";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";
import { isAgencySetupStep } from "@/modules/direito-do-passageiro/agency/setup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("partner-setup-page-title") };
}

// What the agency has in place is read on every request.
export const dynamic = "force-dynamic";

/**
 * /parceiro/configurar: what a travel agency sets up to work with its firm in ONE (migration 0080), one decision
 * per screen. The second factor first, which every write of the agency asks for: the gate opens this page for
 * whoever of the agency owes it, in place of a page of settings that said nothing of the agency (the owner,
 * 2026-11-03). Then, for who manages the agency, its name, the clause of its contract (ONE proposes the words),
 * its team, and how its passengers reach ONE, where the setup ends. The agency's home opens on it while who
 * manages the agency never answered it; this address opens it again at a step (`?passo=`).
 */
export default async function AgencySetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const step = isAgencySetupStep(query.passo) ? query.passo : null;
  return <AgencySetupView state={await loadAgencySetupState(await getMemberContext(), step)} />;
}
