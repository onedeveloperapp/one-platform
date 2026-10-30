import ModulesView, { type ModulesState } from "./modules-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";
import { readModuleOffer } from "@/lib/modules/offer-read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("modules-title") };
}

/**
 * /modulos: ONE's modules for the firm (migrations 0075, 0078): each module the firm contracted, a package of its
 * subscription of ONE, with since when, what it brings and the way into its area; the modules to come; and the ones
 * out that the firm did not contract. Anybody of the firm reads it; the checkout that adds a package to the
 * subscription is ONE's billing (M3), so nothing is bought here. It was a page of the settings until 2026-10-30,
 * whose address still leads here (`next.config.mjs`).
 */
async function loadModules(): Promise<ModulesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "unavailable" };
  const offer = await readModuleOffer(context);
  if (!offer) return { kind: "error" };
  return { kind: "ready", firm: context.firm.name, offer };
}

export default async function ModulesPage() {
  return <ModulesView state={await loadModules()} />;
}
