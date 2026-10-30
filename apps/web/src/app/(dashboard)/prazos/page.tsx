import DeadlinesView, { type DeadlinesState } from "./deadlines-view";
import { redirect } from "next/navigation";

import { deadlinesAddress, isDeadlineView, lastDeadlinePage } from "@/lib/deadlines/deadlines";
import { deadlineActs, loadDeadlines, publicationsWithoutDeadline } from "@/lib/deadlines/facts";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { casesInModule } from "@/lib/modules/scope-read";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * /prazos: the firm's deadlines, read under the person's own session
 * (row-level security shows their firm's only). The rule counts each one
 * over its court's calendar; who runs the deadlines confirms it here.
 * `?ver=` picks a list and `?pagina=` a page of it, and `?modulo=` keeps it to
 * the deadlines of the cases of one module (migration 0078).
 */
async function loadState(
  ver: string | undefined,
  pagina: string | undefined,
  modulo: string | undefined,
): Promise<DeadlinesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const view = isDeadlineView(ver) ? ver : "confirmar";
  const asked = Number.parseInt(pagina ?? "1", 10);
  const page = Number.isInteger(asked) && asked >= 1 && asked <= 10_000 ? asked - 1 : 0;
  const scope = pageScopeOf(context.catalog, context.modules, modulo);
  const module = scope.current?.key ?? null;
  try {
    const [data, acts, untimed, supportVisit] = await Promise.all([
      loadDeadlines(context.supabase, context.firm.id, view, page, context.profile.timezone, module),
      deadlineActs(context.supabase),
      publicationsWithoutDeadline(context.supabase, context.firm.id, context.profile.timezone),
      isSupportVisit(),
    ]);
    // Under a module, the publications that owe a deadline are those of its cases.
    const mine = module
      ? await casesInModule(
          context.supabase,
          context.firm.id,
          untimed.rows.map((row) => row.caseId),
          module,
        )
      : null;
    const role = context.firm.firmFunction;
    return {
      kind: "ready",
      view,
      data,
      acts,
      untimed: mine
        ? { ...untimed, rows: untimed.rows.filter((row) => row.caseId !== null && mine.has(row.caseId)) }
        : untimed,
      scope,
      // Who confirms: a partner or the controladoria. Who works on deadlines: who signs, or runs them.
      // Never a support visit.
      mayConfirm: !supportVisit && (role === "socio" || role === "controladoria"),
      mayWork: !supportVisit && (role === "socio" || role === "advogado" || role === "controladoria"),
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function DeadlinesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : (query[key] as string | undefined));
  const state = await loadState(one("ver"), one("pagina"), one("modulo"));
  // A page past the end of its list is its last page, never a list with nothing in it.
  if (state.kind === "ready" && state.data.rows.length === 0 && state.data.page > 0) {
    redirect(
      deadlinesAddress(
        state.view,
        Math.min(lastDeadlinePage(state.data.total), state.data.page - 1),
        state.scope.current?.key ?? null,
      ),
    );
  }
  return <DeadlinesView state={state} />;
}
