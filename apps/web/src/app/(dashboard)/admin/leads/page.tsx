import LeadsView from "./components/leads-view";

import { loadLeads } from "@/lib/admin/leads";
import { loadNewsletterSends } from "@/lib/admin/newsletter";
import { loadConsole } from "@/lib/admin/session";
import { isEmailConfigured } from "@flyee/email";

export const metadata = { title: "Leads" };

/**
 * Without a job queue, a send to the list is delivered by this page's own
 * server action after it answers (lib/newsletter-jobs.ts), which needs more
 * than the default few seconds.
 */
export const maxDuration = 60;

/**
 * /admin/leads: the waitlist and newsletter contacts, with opt-out, erasure and
 * the consented export (migration 0013), and the messages written to the
 * confirmed list (migration 0023).
 */
export default async function LeadsPage() {
  const state = await loadConsole(async ({ supabase }) => {
    const [leads, sends] = await Promise.all([loadLeads(supabase), loadNewsletterSends(supabase)]);
    return { leads, sends };
  });
  return <LeadsView state={state} canSend={isEmailConfigured} />;
}
