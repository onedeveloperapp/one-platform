import "server-only";

import { accessHref, accessKey, accessOwedOf, accessParams, accessWhat } from "@/lib/filing-ways/access-asks";
import type { Sweep } from "@/lib/jobs/schedule";
import { notifyLocalized } from "@/lib/notifications";
import { deliverOutbox } from "@/lib/whatsapp/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE asks a lawyer for their access where a lawsuit of theirs waits at a court's screen they never said how to file
 * at (migration 0304): each ask owed (`filing_access_owed`) is kept first (`reserve_filing_access_ask`, once per
 * lawsuit, system and lawyer, which also writes the firm's template to the lawyer's WhatsApp, or says why it could
 * not), then rung on the bell with the case open on the choice, and the message sent at once (the outbox's sweep sends
 * what is left). Counts only: nothing of a case goes to the round's record.
 */

/** How many asks one round looks at. */
const PER_ROUND = 50;

export async function askFilingAccess(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const outcomes: Record<string, number> = { asked: 0, whatsapp: 0, skipped: 0, gone: 0 };
  const { data, error } = await service.rpc("filing_access_owed", { target_limit: PER_ROUND });
  if (error) throw new Error("the asks owed could not be read");
  const owed = accessOwedOf(data);
  if (owed.length === 0) return outcomes;
  // The first names of who is asked, read once.
  const { data: people } = await service
    .from("profiles")
    .select("id, display_name")
    .in("id", [...new Set(owed.map((row) => row.userId))]);
  const nameOf = new Map(
    ((people ?? []) as { id: string; display_name: string | null }[]).map((row) => [row.id, row.display_name ?? ""]),
  );
  for (const row of owed) {
    if (Date.now() >= until) break;
    const kept = await service.rpc("reserve_filing_access_ask", {
      target_package: row.packageId,
      target_user: row.userId,
      target_params: accessParams(nameOf.get(row.userId) ?? "", row),
    });
    if (kept.error) continue;
    const answer = (kept.data ?? {}) as { code?: string; message_id?: unknown };
    if (answer.code !== "queued" && answer.code !== "skipped") {
      outcomes.gone += 1;
      continue;
    }
    await notifyLocalized([row.userId], (copy) => copy.filingAccessAsk(accessWhat(row.seq), row.systemName), {
      type: "team",
      href: accessHref(row),
      sourceKey: accessKey(row),
    });
    outcomes.asked += 1;
    if (answer.code === "queued" && typeof answer.message_id === "string") {
      outcomes.whatsapp += 1;
      await deliverOutbox(service, { messageId: answer.message_id }).catch(() => undefined);
    } else {
      outcomes.skipped += 1;
    }
  }
  return outcomes;
}

export const filingAccessSweeps: Sweep[] = [
  /**
   * The lawyers whose access ONE needs to file a package ready at a court's screen (0304): asked once, on the bell and
   * on their WhatsApp, as soon as the package is ready. Every five minutes: a package waits on it.
   */
  {
    key: "filing-access",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => askFilingAccess(service, until),
  },
];
