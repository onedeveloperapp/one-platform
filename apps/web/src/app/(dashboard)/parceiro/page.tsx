import PartnerHome from "./partner-home";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("partner-home-title") };
}

/**
 * Where somebody of a partner of a firm works (migration 0069): the agency, its partnerships, and what each
 * module gives it to do (the passengers of the partnership, in the passenger module).
 */
export default async function PartnerHomePage() {
  const context = await getMemberContext();
  return <PartnerHome partner={context?.partner ?? null} />;
}
