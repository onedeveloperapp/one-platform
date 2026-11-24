import { loadPersonSetupState } from "./person-setup-state";
import PersonSetupView from "./person-setup-view";
import { loadSetupState } from "./setup-state";
import SetupView from "./setup-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { isPersonSetupStep } from "@/lib/firm/person-setup";
import { isManager } from "@/lib/firm/roles";
import { setupStepOf } from "@/lib/firm/setup-steps";
import { getMemberContext } from "@/lib/member/context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("setup-page-title") };
}

/**
 * /configurar: what a firm sets up for ONE to work for it, by who manages it
 * (migrations 0044, 0052, 0054, 0056, 0064): the registration at the bar of
 * who answers and whether they sign what ONE prepares, the Valor da Causa
 * Pedido (or none, for the judge to define), whether it works alone, the
 * papers its clients sign and the
 * channel to them, each done in its step, the second factor and the
 * connections included. The home asks them itself while they were never
 * answered; this address opens them again from the list on the home, at the
 * step something is missing in (`?passo=`), showing what is already in place.
 *
 * For anybody else of the firm it is their own setup (2026-11-03): the second
 * factor and, for a partner or a lawyer, the registration at the bar.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const context = await getMemberContext();
  if (context?.firm && !isManager(context.firm.role)) {
    const step = isPersonSetupStep(query.passo) ? query.passo : null;
    return <PersonSetupView state={await loadPersonSetupState(context, step)} />;
  }
  const step = setupStepOf(query.passo);
  return <SetupView state={await loadSetupState(context, step)} />;
}
