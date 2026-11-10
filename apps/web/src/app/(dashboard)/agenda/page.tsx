import AgendaView, { type AgendaState } from "./agenda-view";
import { redirect } from "next/navigation";

import { isAgendaMode } from "@/lib/agenda/agenda";
import { calendarProvider } from "@/lib/calendar/provider";
import { todayInBrasilia } from "@/lib/deadlines/deadlines";
import { isManager } from "@/lib/firm/roles";
import { colleagues, courtZones, loadHearings, publicationsWithoutHearing } from "@/lib/hearings/facts";
import { agendaAddress, type CourtZones, isHearingView, lastAgendaPage } from "@/lib/hearings/hearings";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { casesInModule } from "@/lib/modules/scope-read";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * /agenda: the firm's hearings, read under the person's own session
 * (row-level security shows their firm's only). `?ver=` picks a list and
 * `?pagina=` a page of it.
 */
async function loadState(
  ver: string | undefined,
  pagina: string | undefined,
  modulo: string | undefined,
  modo: string | undefined,
  dia: string | undefined,
  assinar: string | undefined,
): Promise<AgendaState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const view = isHearingView(ver) ? ver : "proximas";
  const asked = Number.parseInt(pagina ?? "1", 10);
  const page = Number.isInteger(asked) && asked >= 1 && asked <= 10_000 ? asked - 1 : 0;
  // `?modulo=` keeps the agenda to the hearings of the cases of one module (0078).
  const scope = pageScopeOf(context.catalog, context.modules, modulo);
  const module = scope.current?.key ?? null;
  try {
    const [data, team, unwritten, zones, supportVisit] = await Promise.all([
      loadHearings(context.supabase, context.firm.id, view, page, context.profile.timezone, module),
      colleagues(context.supabase, context.firm.id),
      // What owes a hearing is read beside the agenda: a failure of it says so, and never hides the agenda.
      publicationsWithoutHearing(context.supabase, context.firm.id, context.profile.timezone).catch(() => null),
      courtZones(context.supabase).catch((): Record<string, CourtZones> => ({})),
      isSupportVisit(),
    ]);
    // Under a module, the publications that owe a hearing are those of its cases.
    const mine =
      module && unwritten
        ? await casesInModule(
            context.supabase,
            context.firm.id,
            unwritten.rows.map((row) => row.caseId),
            module,
          )
        : null;
    const role = context.firm.firmFunction;
    return {
      kind: "ready",
      view,
      // Lista, Dia, Semana or Mês (0132): the list is the hearings' views; the others the calendar of the days.
      mode: isAgendaMode(modo) ? modo : "lista",
      day: dia && /^\d{4}-\d{2}-\d{2}$/.test(dia) ? dia : todayInBrasilia(),
      meId: context.userId,
      subscribe: assinar === "1",
      data,
      colleagues: team,
      unwritten:
        mine && unwritten
          ? { ...unwritten, rows: unwritten.rows.filter((row) => row.caseId !== null && mine.has(row.caseId)) }
          : unwritten,
      scope,
      courtZones: zones,
      // Who writes hearings: who signs, or runs the deadlines. Never a support visit.
      mayWork: !supportVisit && (role === "socio" || role === "advogado" || role === "controladoria"),
      managesFirm: isManager(context.firm.role),
      calendarAvailable: calendarProvider() !== null,
    };
  } catch {
    return { kind: "error" };
  }
}

export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : (query[key] as string | undefined));
  const state = await loadState(one("ver"), one("pagina"), one("modulo"), one("modo"), one("dia"), one("assinar"));
  // A page past the end of its list is its last page, never a list with nothing in it.
  if (state.kind === "ready" && state.mode === "lista" && state.data.rows.length === 0 && state.data.page > 0) {
    redirect(
      agendaAddress(
        state.view,
        Math.min(lastAgendaPage(state.data.total), state.data.page - 1),
        state.scope.current?.key ?? null,
      ),
    );
  }
  return <AgendaView state={state} />;
}
