import PartnersView from "./partners-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";
import { readFirmPartners } from "@/lib/partners/facts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("partners-title") };
}

/**
 * The firm's partners (migration 0069): the travel agencies that add the passengers of the partnership in an area
 * of their own. Anybody of the firm reads the partnerships; who manages the firm invites an agency, takes an
 * invitation back and ends a partnership, each with the second factor.
 */
export default async function PartnersPage() {
  const context = await getMemberContext();
  const state = await readFirmPartners(context);
  return <PartnersView state={state} modules={context?.modules ?? []} />;
}
