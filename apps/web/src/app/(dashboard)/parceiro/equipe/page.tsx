import PartnerTeamView from "./partner-team-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";
import { readPartnerTeam } from "@/lib/partners/facts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("partner-team-title") };
}

/** The agency's own team (migration 0069): who works in it, and, to who manages it, the colleagues invited. */
export default async function PartnerTeamPage() {
  const context = await getMemberContext();
  const state = await readPartnerTeam(context);
  return <PartnerTeamView state={state} partner={context?.partner ?? null} />;
}
