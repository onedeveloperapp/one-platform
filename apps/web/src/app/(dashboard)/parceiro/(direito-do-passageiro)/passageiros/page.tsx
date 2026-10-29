import PassengersView from "./passengers-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { agencyAccess, readClause, readOverview, readTravelers } from "@/modules/direito-do-passageiro/agency/facts";
import { PAX_PAGE_SIZE } from "@/modules/direito-do-passageiro/agency/passengers";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("pax-title") };
}

// What the agency reads is read on every request.
export const dynamic = "force-dynamic";

/**
 * The passengers a travel agency's partnership covers (migration 0070): who they are, whether they agreed on
 * their link, what documents they have and when they fly. The agency adds them one by one or from a spreadsheet,
 * and registers the clause of its contract the passenger reads on the link.
 */
export default async function PassengersPage() {
  const access = await agencyAccess();
  if (!access.ok) return <PassengersView data={null} />;
  const [overview, page, clause] = await Promise.all([
    readOverview(access.context, access.partnership.id),
    readTravelers(access.context, access.partnership.id, {
      search: "",
      filter: "all",
      offset: 0,
      limit: PAX_PAGE_SIZE,
    }),
    readClause(access.context, access.agency.id),
  ]);
  return (
    <PassengersView
      data={{
        firm: access.partnership.firm,
        manager: access.agency.manager,
        overview: overview.ok ? overview.value : null,
        page: page.ok ? page.value : null,
        clause: clause.ok ? clause.value : null,
        clauseRead: clause.ok,
      }}
    />
  );
}
