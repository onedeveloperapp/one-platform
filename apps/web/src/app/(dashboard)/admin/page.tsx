import OverviewView, { type AdminMetrics } from "./components/overview-view";

import { loadConsole } from "@/lib/admin/session";

export const metadata = { title: "Administração" };

/** /admin: the platform's numbers (`admin_metrics()`, migration 0015) and the door to every console. */
export default async function AdminOverviewPage() {
  const state = await loadConsole(async ({ supabase }) => {
    const { data, error } = await supabase.rpc("admin_metrics");
    if (error || !data) throw new Error("admin_metrics_failed");
    return { metrics: data as AdminMetrics };
  });
  return <OverviewView state={state} />;
}
