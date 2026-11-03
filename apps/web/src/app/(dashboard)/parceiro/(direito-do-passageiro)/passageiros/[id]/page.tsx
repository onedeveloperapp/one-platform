import PassengerView from "./passenger-view";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { agencyAccess, readClause, readTraveler } from "@/modules/direito-do-passageiro/agency/facts";
import { readTravelerFlights } from "@/modules/direito-do-passageiro/agency/flight-progress-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("pax-detail-title") };
}

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The day in Brazil's official time: who is a child is decided by it. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * One passenger of the agency's partnership (migration 0070): their record, the link on which they agree, their
 * documents and their trips. A passenger the agency cannot read, or that does not exist, is said as not found; a
 * read that failed is said as failed.
 */
export default async function PassengerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await agencyAccess();
  if (!access.ok || !UUID.test(id)) return <PassengerView state={{ kind: "missing" }} />;
  const [read, clause, flights] = await Promise.all([
    readTraveler(access.context, id),
    readClause(access.context, access.agency.id),
    readTravelerFlights(id),
  ]);
  if (read === null) return <PassengerView state={{ kind: "missing" }} />;
  if (!read.ok) return <PassengerView state={{ kind: "failed" }} />;
  return (
    <PassengerView
      key={id}
      state={{
        kind: "ready",
        detail: read.value,
        firm: access.partnership.firm,
        // A clause that could not be read is never said to be missing: the database refuses the link anyway.
        hasClause: clause.ok ? clause.value !== null : true,
        today: todayInBrazil(),
        manager: access.agency.manager,
        // The flights of the passenger's trips as they happen; a read that failed shows none of them.
        flights,
      }}
    />
  );
}
