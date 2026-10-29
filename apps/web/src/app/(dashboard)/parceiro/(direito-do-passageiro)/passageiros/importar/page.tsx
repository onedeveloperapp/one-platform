import ImportView from "./import-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { agencyAccess } from "@/modules/direito-do-passageiro/agency/facts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("pax-import-title") };
}

/**
 * The agency's passengers from a spreadsheet of its own system (migration 0070, `pax_import_rows`): read in the
 * person's browser, each column confirmed, only the lines that go sent, a few at a time.
 */
export default async function ImportPassengersPage() {
  const access = await agencyAccess();
  return <ImportView firm={access.ok ? access.partnership.firm : null} />;
}
