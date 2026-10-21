import CalendarConsoleView from "./calendar-console-view";

import { loadCalendarConsole } from "@/lib/admin/calendar";
import { loadConsole } from "@/lib/admin/session";
import { todayInBrasilia } from "@/lib/deadlines/deadlines";

export const metadata = { title: "Calendário forense" };

/**
 * /admin/calendario: the forensic calendar every firm's deadlines are
 * counted over (migration 0034). Per court, which years were checked
 * against the court's own act and whose comarcas' days they hold; the days
 * of one court and year (the ones it had no business, suspended the terms
 * or had partial business); and the acts of the list with the days the law
 * gives them. `?tribunal=` and `?ano=` pick what is shown. Reference data:
 * nothing of a firm.
 */
export default async function CalendarConsolePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const one = (key: string) => (Array.isArray(query[key]) ? query[key]?.[0] : (query[key] as string | undefined));
  const year = Number.parseInt(one("ano") ?? "", 10);
  const thisYear = Number(todayInBrasilia().slice(0, 4));
  const state = await loadConsole(async ({ supabase }) => ({
    calendar: await loadCalendarConsole(
      supabase,
      { court: one("tribunal") ?? null, year: Number.isInteger(year) ? year : null },
      thisYear,
    ),
    thisYear,
  }));
  return <CalendarConsoleView state={state} />;
}
