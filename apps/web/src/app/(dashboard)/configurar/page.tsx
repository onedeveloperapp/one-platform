import { loadSetupState } from "./setup-state";
import SetupView from "./setup-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { isSetupStep } from "@/lib/firm/setup-steps";
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
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const step = isSetupStep(query.passo) ? query.passo : null;
  return <SetupView state={await loadSetupState(await getMemberContext(), step)} />;
}
