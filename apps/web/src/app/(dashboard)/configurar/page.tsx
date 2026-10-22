import { loadSetupState } from "./setup-state";
import SetupView from "./setup-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { getMemberContext } from "@/lib/member/context";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("setup-page-title") };
}

/**
 * /configurar: the first questions of a firm, asked once by who manages it
 * (migration 0044): the registration at the bar of who answers and whether
 * they sign what ONE prepares, whether the firm works alone, and the channel
 * to the clients. Everything else comes ready. The home asks them itself
 * while they were never answered; this address opens them again from the
 * list on the home, showing what is already in place.
 */
export default async function SetupPage() {
  return <SetupView state={await loadSetupState(await getMemberContext())} />;
}
