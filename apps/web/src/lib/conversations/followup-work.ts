import "server-only";

import { intakeFactsOf, leadFollowupText } from "@/lib/conversations/intake";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The lead who stopped answering (migration 0207), the backend's half: ONE follows up an intake under way on
 * WhatsApp, inside the 24 hours, at the setting's hours after its last question, saying again what it still needs;
 * the database decides who is owed it and writes it once, as ONE's message, and the outbox sends it.
 */
export async function leadFollowupRound(service: SupabaseClient, until: number): Promise<SweepReport> {
  const report = { sent: 0, skipped: 0 };
  const { data, error } = await service.rpc("lead_followups_owed", { target_limit: 20 });
  if (error) throw new Error("lead_followups_owed failed");
  for (const row of (Array.isArray(data) ? data : []) as {
    conversation_id: string;
    followups: number;
    intake: unknown;
  }[]) {
    if (Date.now() >= until) break;
    const body = leadFollowupText(intakeFactsOf(row.intake), Number(row.followups) || 0);
    if (!body) {
      report.skipped += 1;
      continue;
    }
    const { data: answer, error: followError } = await service.rpc("one_lead_followup", {
      target_conversation: row.conversation_id,
      target_body: body,
    });
    if (followError || (answer as { ok?: boolean } | null)?.ok !== true) {
      report.skipped += 1;
      continue;
    }
    report.sent += 1;
  }
  return report;
}

export const leadFollowupSweeps: Sweep[] = [
  {
    // A person waits on the conversation: swept while ONE is used too.
    key: "lead-followups",
    when: { every: 15 },
    whileUsed: true,
    run: (service, until) => leadFollowupRound(service, until),
  },
];
