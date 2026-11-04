import "server-only";

import { notifyLocalized } from "@/lib/notifications";
import { localTimeLabel } from "@/modules/direito-do-passageiro/agency/passengers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The agency's bell of a passenger who flies soon with no agreement (migration 0094): once per trip, by its key, to
 * who manages the agency and who registered the passenger (`pax_unagreed_notices_owed` says who). The database
 * decides who is owed; a notice already written is not written again, so a round may run any number of times.
 * Counts only.
 */

type Owed = { traveler_id: string; trip_id: string; full_name: string; departure: string; recipients: string[] | null };

/** How many passengers one round looks at. */
const PER_ROUND = 200;

export async function tellUnagreedDepartures(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("pax_unagreed_notices_owed", { target_limit: PER_ROUND });
  if (error) throw new Error("the passengers who fly with no agreement could not be read");
  const outcomes: Record<string, number> = { told: 0, already: 0, nobody: 0 };
  for (const row of (data ?? []) as Owed[]) {
    if (Date.now() >= until) break;
    const recipients = row.recipients ?? [];
    if (recipients.length === 0) {
      outcomes.nobody += 1;
      continue;
    }
    const result = await notifyLocalized(
      recipients,
      (copy) => copy.paxUnagreedDeparture(row.full_name, localTimeLabel(row.departure)),
      {
        type: "team",
        href: `/parceiro/passageiros/${row.traveler_id}#acordo`,
        sourceKey: `pax-unagreed:${row.trip_id}`,
      },
    );
    if ((result.created ?? 0) > 0) outcomes.told += 1;
    else outcomes.already += 1;
  }
  return outcomes;
}
