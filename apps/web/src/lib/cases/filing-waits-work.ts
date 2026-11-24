import "server-only";

import { filingWaitsOwedOf, filingWaitsParams, remindNow, sinceWords, systemWords } from "@/lib/cases/filing-waits";
import type { Sweep } from "@/lib/jobs/schedule";
import { notifyLocalized } from "@/lib/notifications";
import { deliverOutbox } from "@/lib/whatsapp/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The reminder of a package that waits to be filed (migration 0269): each round owed (`filing_waits_owed`) is kept
 * first (`reserve_filing_waits`, once per package, lawyer and round, which also writes the firm's template to the
 * lawyer's WhatsApp, or says why it could not), then rung on the bell and the message sent at once (the outbox's
 * sweep sends what is left). Only on a weekday's working hours in Brasília (`remindNow`). Counts only: nothing of a
 * case goes to the round's record.
 */

/** How many reminders one round looks at. */
const PER_ROUND = 50;

export async function remindFilingWaits(
  service: SupabaseClient,
  until: number,
  now: Date = new Date(),
): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = { told: 0, whatsapp: 0, skipped: 0, already: 0, gone: 0 };
  if (!remindNow(now)) return { ...outcomes, off_hours: 1 };
  const { data, error } = await service.rpc("filing_waits_owed", { target_limit: PER_ROUND });
  if (error) throw new Error("the reminders owed could not be read");
  for (const owed of filingWaitsOwedOf(data)) {
    if (Date.now() >= until) break;
    const kept = await service.rpc("reserve_filing_waits", {
      target_package: owed.packageId,
      target_user: owed.userId,
      target_round: owed.round,
      target_params: filingWaitsParams(owed),
    });
    if (kept.error) continue;
    const answer = (kept.data ?? {}) as { code?: string; message_id?: unknown };
    if (answer.code === "already") {
      outcomes.already += 1;
      continue;
    }
    if (answer.code !== "queued" && answer.code !== "skipped") {
      outcomes.gone += 1;
      continue;
    }
    const what = owed.seq !== null ? `A ação do caso nº ${owed.seq}` : "A ação";
    const bell = await notifyLocalized(
      [owed.userId],
      (copy) => copy.filingWaits(what, systemWords(owed), sinceWords(owed.since)),
      {
        type: "team",
        href: `/casos/${owed.caseId}#case-filing`,
        sourceKey: `filing-waits:${owed.packageId}:${owed.round}`,
      },
    );
    if ((bell.created ?? 0) > 0) outcomes.told += 1;
    if (answer.code === "queued" && typeof answer.message_id === "string") {
      outcomes.whatsapp += 1;
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    } else {
      outcomes.skipped += 1;
    }
  }
  return outcomes;
}

export const filingWaitsSweeps: Sweep[] = [
  /**
   * The packages ready to file that nobody files (0269): told to the lawyers of their lawsuits, on the bell and on
   * their WhatsApp, a round at a time. Once an hour is enough: a reminder is a matter of days.
   */
  {
    key: "filing-waits",
    when: { hourly: 20 },
    run: async (service, until) => remindFilingWaits(service, until),
  },
];
