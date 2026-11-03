import { loadPassengerSetupState } from "./passenger-setup-state";
import PassengerSetupView, { isPassengerSetupStep } from "./passenger-setup-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("module-setup-crumb") };
}

// What the firm has in place is read on every request.
export const dynamic = "force-dynamic";

/**
 * /configurar/direito-do-passageiro: the passenger module's own setup (migration 0081, `firmSetup` of the module's
 * definition), which the firm's core setup opens when it finishes, for a firm that contracted the module and never
 * answered it, and which the home's list leads back to. In the module's colour; only what this module needs.
 */
export default async function PassengerSetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const step = isPassengerSetupStep(query.passo) ? query.passo : null;
  return <PassengerSetupView state={await loadPassengerSetupState(await getMemberContext(), step)} />;
}
