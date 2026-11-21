import FilingQueueView, { type FilingQueueState } from "./filing-queue-view";

import { loadFilingQueue } from "@/lib/cases/filing-facts";
import { loadFilingBatches } from "@/lib/filing-ways/batches-read";
import { isQueueView } from "@/lib/cases/filing-queue";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";

/**
 * /protocolo: the firm's filing queue. Every package that waits (being
 * built, ready for the lawyer, or failed), read under the person's own
 * session: row-level security shows the packages of their firm only. The
 * work on each is done on its case. `?modulo=` keeps it to the packages of
 * the cases of one module (migration 0078), and `?ver=` opens one of its
 * ready views (`prontos`: the packages ready to file).
 */
async function loadQueue(modulo: string | undefined, ver: string | undefined): Promise<FilingQueueState> {
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
    // What ONE files on the courts' screens (0264): the batches in course and what the person may hand ONE.
    const batches = await loadFilingBatches(context, queue.rows);
    return {
      kind: "ready",
      firm: context.firm.name,
      firmId: context.firm.id,
      batches,
      rows: queue.rows,
      truncated: queue.truncated,
      cloudSigning: queue.cloudSigning,
      lawyer: context.firm.firmFunction === "socio" || context.firm.firmFunction === "advogado",
      scope,
      view: isQueueView(ver) ? ver : "todos",
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
  const ver = Array.isArray(query.ver) ? query.ver[0] : query.ver;
  return <FilingQueueView state={await loadQueue(modulo, ver)} />;
}
