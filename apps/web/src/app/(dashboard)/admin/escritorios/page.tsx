import FirmsView from "./components/firms-view";

import { loadFirmsOverview, loadPartnerOverview, loadPeopleWithoutFirm } from "@/lib/admin/firms";
import { loadConsole } from "@/lib/admin/session";

export const metadata = { title: "Escritórios" };

/**
 * /admin/escritorios: every firm of the platform, its team, its plan and what
 * needs attention, read through `admin_firms_overview()` (migration 0012),
 * plus the accounts that belong to no firm.
 */
export default async function FirmsPage({ searchParams }: { searchParams: Promise<{ impersonation?: string }> }) {
  const { impersonation } = await searchParams;
  const state = await loadConsole(async ({ supabase, userId }) => {
    const [overview, people, partners] = await Promise.all([
      loadFirmsOverview(supabase),
      loadPeopleWithoutFirm(supabase),
      loadPartnerOverview(supabase),
    ]);
    return {
      overview,
      people,
      partners,
      selfId: userId,
      serviceAvailable: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    };
  });
  // Where a support session lands when it ends (api/impersonation/exit).
  const notice = impersonation === "expired" ? "expired" : impersonation === "ended" ? "ended" : null;
  return <FirmsView state={state} notice={notice} />;
}
