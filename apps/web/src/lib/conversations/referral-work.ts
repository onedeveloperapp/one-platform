import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The closing and the referral (migration 0183, item 4.7 of the case journey plan): once the client confirmed on their
 * link that their money arrived, ONE thanks them in the firm's name and asks them to pass the firm's contact to
 * whoever else had a problem with a flight, offering nothing in exchange (the OAB's Código de Ética forbids paying or
 * rewarding a referral). Once per case, in the conversation ONE holds, inside the 24 hours.
 */

/** ONE's thanks and its ask, in plain words, with nothing promised in exchange. */
export function referralMessage(firstName: string): string {
  const name = firstName.trim();
  return [
    `${name ? `${name}, o` : "O"} escritório agradece a sua confiança. Foi bom cuidar do seu caso.`,
    "Se alguém que você conhece também teve problema com um voo, pode passar este contato e pedir que diga que foi indicado por você.",
    "O escritório não oferece nada em troca de uma indicação.",
  ].join(" ");
}

/** Writes and sends each thanks owed now; answers how many went. */
export async function askReferrals(service: SupabaseClient, limit = 20): Promise<number> {
  const { data, error } = await service.rpc("referral_asks_owed", { target_limit: limit });
  if (error) throw new Error("referral_asks_owed failed");
  let asked = 0;
  for (const row of (data ?? []) as { case_id: string; first_name: string | null }[]) {
    const written = await service.rpc("one_ask_referral", {
      target_case: row.case_id,
      target_body: referralMessage(row.first_name ?? ""),
    });
    const answer = (written.data ?? {}) as { ok?: boolean; message_id?: unknown };
    if (written.error || !answer.ok) continue;
    asked += 1;
    if (typeof answer.message_id === "string") {
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    }
  }
  return asked;
}

/** Right after the client confirmed their money: the thanks goes now, never waited for by them. */
export function queueReferralAsks(): void {
  soon("referral-asks", async () => {
    await askReferrals(createServiceClient());
  });
}

export const referralSweeps: Sweep[] = [
  {
    // The thanks ONE owes after a client confirmed their money (0183): also while ONE is used, since each is written
    // once under the case's own lock.
    key: "referral-asks",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => ({ asked: await askReferrals(service) }),
  },
];
