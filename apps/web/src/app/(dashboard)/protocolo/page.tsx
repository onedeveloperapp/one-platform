import FilingQueueView, { type FilingQueueState } from "./filing-queue-view";

import { loadFilingQueue } from "@/lib/cases/filing-facts";
import { getMemberContext } from "@/lib/member/context";

/**
 * /protocolo: the firm's filing queue. Every package that waits (being
 * built, ready for the lawyer, or failed), read under the person's own
 * session: row-level security shows the packages of their firm only. The
 * work on each is done on its case.
 */
async function loadQueue(): Promise<FilingQueueState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  try {
    const queue = await loadFilingQueue(context.supabase, context.firm.id, context.profile.timezone);
    return {
      kind: "ready",
      firm: context.firm.name,
      rows: queue.rows,
      truncated: queue.truncated,
      cloudSigning: queue.cloudSigning,
      lawyer: context.firm.firmFunction === "socio" || context.firm.firmFunction === "advogado",
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function FilingQueuePage() {
  return <FilingQueueView state={await loadQueue()} />;
}
