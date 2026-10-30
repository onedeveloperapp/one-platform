import FilingQueueView, { type FilingQueueState } from "./filing-queue-view";

import { loadFilingQueue } from "@/lib/cases/filing-facts";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";

/**
 * /protocolo: the firm's filing queue. Every package that waits (being
 * built, ready for the lawyer, or failed), read under the person's own
 * session: row-level security shows the packages of their firm only. The
 * work on each is done on its case. `?modulo=` keeps it to the packages of
 * the cases of one module (migration 0078).
 */
async function loadQueue(modulo: string | undefined): Promise<FilingQueueState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const scope = pageScopeOf(context.catalog, context.modules, modulo);
  try {
    const queue = await loadFilingQueue(
      context.supabase,
      context.firm.id,
      context.profile.timezone,
      scope.current?.key ?? null,
    );
    return {
      kind: "ready",
      firm: context.firm.name,
      rows: queue.rows,
      truncated: queue.truncated,
      cloudSigning: queue.cloudSigning,
      lawyer: context.firm.firmFunction === "socio" || context.firm.firmFunction === "advogado",
      scope,
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function FilingQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const modulo = Array.isArray(query.modulo) ? query.modulo[0] : query.modulo;
  return <FilingQueueView state={await loadQueue(modulo)} />;
}
