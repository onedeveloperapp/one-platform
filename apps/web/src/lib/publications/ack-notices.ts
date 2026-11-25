import "server-only";

import { notifyLocalized } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The bell of the awareness of ONE's triage (migration 0104): each publication ONE triaged that no person said they
 * are aware of is told to who it waits on, once when ONE triaged it and, past the setting's hours, once a day until
 * somebody says it. `publication_acks_owed` (0295) answers only what is still owed, who has not had the notice or
 * the day's reminder, with the keys to write them under, so a round with nothing new reads one answer and writes
 * nothing, and the bell's unique key still fences a notice two rounds race to write. Counts only: nothing of a
 * publication goes to a log.
 */

type Owed = {
  publication_id: string;
  case_id: string | null;
  seq: number | null;
  category: string | null;
  told_key: string;
  to_tell: string[] | null;
  reminder_key: string;
  to_remind: string[] | null;
};

/** How many publications one round looks at. */
const PER_ROUND = 200;

/** What ONE said a publication is, as the bell says it: "O ONE triou como uma audiência uma publicação". */
const WHAT: Record<string, string> = {
  prazo: "um prazo",
  audiencia: "uma audiência",
  decisao: "uma decisão",
  pagamento: "um pagamento",
  ciencia: "ciência",
  outro: "outro assunto",
};

/** Tells what is owed, of every publication or of the one ONE has just triaged. */
export async function tellPublicationAcks(
  service: SupabaseClient,
  until: number,
  onlyPublication: string | null = null,
): Promise<Record<string, number>> {
  const owed = await service.rpc("publication_acks_owed", {
    target_limit: PER_ROUND,
    target_publication: onlyPublication ?? undefined,
  });
  if (owed.error) throw new Error("the awareness owed could not be read");
  const rows = (owed.data ?? []) as Owed[];
  const outcomes: Record<string, number> = { told: 0, reminded: 0 };
  if (rows.length === 0) return outcomes;
  // The hours a reminder says the publication waits past, read only when there is something to tell.
  const setting = await service.from("platform_settings").select("value").eq("key", "publications").maybeSingle();
  const configured = Number((setting.data?.value as Record<string, unknown> | null | undefined)?.ack_late_hours);
  const hours = Number.isInteger(configured) && configured > 0 ? configured : 4;
  for (const row of rows) {
    if (Date.now() >= until) break;
    const what = WHAT[row.category ?? ""] ?? WHAT.outro;
    const where = row.seq ? `do caso nº ${row.seq}` : "";
    const href = row.case_id ? `/casos/${row.case_id}#case-publications` : "/publicacoes";
    const toTell = row.to_tell ?? [];
    if (toTell.length > 0) {
      const first = await notifyLocalized(toTell, (copy) => copy.publicationTriaged(what, where), {
        type: "team",
        href,
        sourceKey: row.told_key,
      });
      if ((first.created ?? 0) > 0) outcomes.told += 1;
    }
    const toRemind = row.to_remind ?? [];
    if (toRemind.length > 0) {
      const again = await notifyLocalized(toRemind, (copy) => copy.publicationAckLate(what, where, hours), {
        type: "team",
        href,
        sourceKey: row.reminder_key,
      });
      if ((again.created ?? 0) > 0) outcomes.reminded += 1;
    }
  }
  return outcomes;
}
