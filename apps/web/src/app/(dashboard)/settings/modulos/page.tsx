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
 * /settings/modulos: ONE's modules for the firm (migrations 0075, 0078), in the settings of the firm beside "Plano e
 * pagamentos", where a package is contracted (the owner, 2026-11-14, who found the menu of the modules a repetition of
 * Casos): each module the firm contracted with since when and what it covers, the way to its cases; the modules to
 * come; and the ones out that the firm did not contract. Anybody of the firm reads it; nothing is bought here.
 */
async function loadModules(): Promise<ModulesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "unavailable" };
  const offer = await readModuleOffer(context);
  if (!offer) return { kind: "error" };
  return { kind: "ready", firm: context.firm.name, offer };
}

export default async function SettingsModulesPage() {
  return <ModulesView state={await loadModules()} />;
}
