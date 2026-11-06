import "server-only";

import { notifyLocalized } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The bell of the awareness of ONE's triage (migration 0104): each publication ONE triaged that no person said they
 * are aware of is told to who it waits on (`publication_acks_owed` says who: the lawyers it was addressed to, or,
 * with none of the firm, who triages), once when ONE triaged it and, past the setting's hours, once a day until
 * somebody says it. A notice already written is not written again (its key), so a round may run any number of
 * times. Counts only: nothing of a publication goes to a log.
 */

type Owed = {
  publication_id: string;
  case_id: string | null;
  seq: number | null;
  category: string | null;
  late: boolean;
  recipients: string[] | null;
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

/** The day in Brasília, which names the reminder of each day. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function tellPublicationAcks(
  service: SupabaseClient,
  until: number,
  onlyPublication: string | null = null,
): Promise<Record<string, number>> {
  const [owed, setting] = await Promise.all([
    service.rpc("publication_acks_owed", { target_limit: PER_ROUND }),
    service.from("platform_settings").select("value").eq("key", "publications").maybeSingle(),
  ]);
  if (owed.error) throw new Error("the awareness owed could not be read");
  const configured = Number((setting.data?.value as Record<string, unknown> | null | undefined)?.ack_late_hours);
  const hours = Number.isInteger(configured) && configured > 0 ? configured : 4;
  const day = today();
  const outcomes: Record<string, number> = { told: 0, reminded: 0, nobody: 0 };
  for (const row of (owed.data ?? []) as Owed[]) {
    if (Date.now() >= until) break;
    if (onlyPublication && row.publication_id !== onlyPublication) continue;
    const recipients = row.recipients ?? [];
    if (recipients.length === 0) {
      outcomes.nobody += 1;
      continue;
    }
    const what = WHAT[row.category ?? ""] ?? WHAT.outro;
    const where = row.seq ? `do caso nº ${row.seq}` : "";
    const href = row.case_id ? `/casos/${row.case_id}#case-publications` : "/publicacoes";
    const first = await notifyLocalized(recipients, (copy) => copy.publicationTriaged(what, where), {
      type: "team",
      href,
      sourceKey: `pub-ack:${row.publication_id}`,
    });
    if ((first.created ?? 0) > 0) outcomes.told += 1;
    if (row.late) {
      const again = await notifyLocalized(recipients, (copy) => copy.publicationAckLate(what, where, hours), {
        type: "team",
        href,
        sourceKey: `pub-ack-late:${row.publication_id}:${day}`,
      });
      if ((again.created ?? 0) > 0) outcomes.reminded += 1;
    }
  }
  return outcomes;
}
