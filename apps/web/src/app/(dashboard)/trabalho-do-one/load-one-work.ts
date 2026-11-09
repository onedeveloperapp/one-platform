import "server-only";

import { cookies } from "next/headers";

import { momentLabel } from "@/lib/ai/approvals";
import { getMemberContext } from "@/lib/member/context";
import { type ModuleCard, pageScopeOf } from "@/lib/modules/offer";
import { readOneWork } from "@/lib/one-work/read";
import { brasiliaMonth, monthShift, type OneWork } from "@/lib/one-work/work";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/** How many months the page reads, the current one included: the choice of month and the spreadsheet. */
export const MONTHS_READ = 12;

export type OneWorkState =
  | {
      kind: "ready";
      work: OneWork;
      /** The month the page shows, "YYYY-MM", and the month of Brasília today. */
      month: string;
      current: string;
      modules: ModuleCard[];
      module: ModuleCard | null;
      firmName: string;
      /** Whether the person may change the firm's estimates: who decides for it, never in a support visit. */
      adjusts: boolean;
      readLabel: string;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What `/trabalho-do-one` reads, under the person's own session: what ONE did for the firm in the last twelve months
 * of Brasília (`firm_one_work`, migrations 0120 and 0121), of every module or of one. Anybody of the firm reads the tasks and
 * the hours; the firm's estimates and the money only who decides for it. `?mes=` chooses a month of those read.
 */
export async function loadOneWork(params: { mes?: string; modulo?: string }): Promise<OneWorkState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const { modules, current: module } = pageScopeOf(context.catalog, context.modules, params.modulo);
  const current = brasiliaMonth();
  const first = monthShift(current, -(MONTHS_READ - 1));
  const [work, cookieStore] = await Promise.all([
    readOneWork(context.supabase, context.firm.id, first, current, module?.key ?? null),
    cookies(),
  ]);
  if (!work) return { kind: "error" };
  const month = params.mes && params.mes >= first && params.mes <= current ? params.mes : current;
  return {
    kind: "ready",
    work,
    month,
    current,
    modules,
    module,
    firmName: context.firm.name,
    adjusts: work.decides && !cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    readLabel: momentLabel(new Date().toISOString(), context.profile.timezone),
  };
}
