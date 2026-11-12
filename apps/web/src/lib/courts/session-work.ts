import "server-only";

import { calendarOf } from "@/lib/deadlines/deadlines";
import { courtCalendar } from "@/lib/deadlines/facts";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { oralArgumentLimit, type OralLimit } from "@flyee/rules/sessions";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend counts the limit to register for oral argument of each session of judgment (migration 0219) with the
 * pure rule (`@flyee/rules/sessions`) over the court's calendar, for the revision of the session it read: a session
 * changed meanwhile is counted again by its own turn. A court with no rule here, or a calendar that could not be read,
 * is said so on the session, never guessed. What it writes is counts only.
 */

type ToCount = {
  session_id: string;
  revision: number;
  kind: string;
  starts_on: string;
  starts_at: string | null;
  court: string | null;
  proceeding_kind: string | null;
  system: string | null;
  comarca: string | null;
  until_kind: string | null;
  until_hour: string | null;
  basis: string | null;
};

const hourOf = (value: string | null): string | null => (value ? value.slice(0, 5) : null);

export async function countSessionLimits(service: SupabaseClient, limit = 20): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("sessions_to_count", { target_limit: limit });
  if (error) throw new Error("sessions_to_count failed");
  const rows = (data ?? []) as ToCount[];
  const outcomes: Record<string, number> = { counted: 0, uncounted: 0, changed: 0, waiting: 0 };
  const calendars = new Map<string, Awaited<ReturnType<typeof courtCalendar>> | null>();
  for (const row of rows) {
    const startsOn = String(row.starts_on).slice(0, 10);
    let payload: Record<string, unknown>;
    if (!row.court || !row.until_kind || !row.basis) {
      payload = { error: "no_rule" };
    } else {
      // The day before may fall in the year before: both years are read in January.
      const years = [Number(startsOn.slice(0, 4))];
      if (startsOn.slice(5, 7) === "01") years.unshift(years[0]! - 1);
      const read = [];
      for (const year of years) {
        const key = `${row.court}:${year}`;
        if (!calendars.has(key)) {
          calendars.set(key, await courtCalendar(service, row.court, year).catch(() => null));
        }
        read.push(calendars.get(key) ?? null);
      }
      if (read.some((rows) => rows === null)) {
        // The calendar could not be read now: counted at the next round.
        outcomes.waiting += 1;
        continue;
      }
      const calendar = calendarOf(
        read.flatMap((rows) => rows!.years),
        read.flatMap((rows) => rows!.days),
      );
      const outcome = oralArgumentLimit({
        startsOn,
        startsAt: hourOf(row.starts_at),
        rule: { until: row.until_kind as OralLimit, hour: hourOf(row.until_hour), basis: row.basis },
        calendar,
        place: { proceedingKind: row.proceeding_kind, system: row.system, comarca: row.comarca },
      });
      payload = outcome.ok
        ? {
            on: outcome.limit.on,
            hour: outcome.limit.hour,
            basis: outcome.limit.basis,
            passed: outcome.limit.passed,
            rule: outcome.limit.ruleVersion,
          }
        : { error: outcome.code };
    }
    const { data: recorded, error: refused } = await service.rpc("record_session_limit", {
      target_session: row.session_id,
      target_revision: row.revision,
      payload,
    });
    if (refused) throw new Error("record_session_limit failed");
    const code = (recorded as { code?: string } | null)?.code;
    if (code === "changed") outcomes.changed += 1;
    else if (payload.error) outcomes.uncounted += 1;
    else outcomes.counted += 1;
  }
  return outcomes;
}

/** The limit of a session a person just recorded or changed, counted right after their answer. */
export async function queueSessionLimits(): Promise<void> {
  soon("session-limits", () => countSessionLimits(createServiceClient(), 5));
}

export const sessionSweeps: Sweep[] = [
  /**
   * The limits to register for oral argument (migration 0219): of each session ONE read from a pauta or a person
   * recorded, counted again when the session changes.
   */
  {
    key: "session-limits",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => countSessionLimits(service, 20),
  },
];
