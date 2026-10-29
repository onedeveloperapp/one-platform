import IntegrationView from "./integration-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { memberUrl } from "@/lib/messages/format";
import { agencyAccess, readApiKeys } from "@/modules/direito-do-passageiro/agency/facts";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("pax-api-title") };
}

export const dynamic = "force-dynamic";

/**
 * The agency's API (migration 0073): the keys of its partnership for its booking system, and how to call ONE with
 * them. Who manages the agency creates and revokes keys; anybody of it reads how to use them.
 */
export default async function IntegrationPage() {
  const access = await agencyAccess();
  if (!access.ok) return <IntegrationView data={null} />;
  const keys = await readApiKeys(access.context, access.partnership.id);
  return (
    <IntegrationView
      data={{
        manager: access.agency.manager,
        keys: keys.ok ? keys.value : null,
        base: memberUrl("/api/parceiros/v1"),
      }}
    />
  );
}
