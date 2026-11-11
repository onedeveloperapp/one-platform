import "server-only";

import { briefDue, briefFactsOf, briefLines, staffParams, whenLabel } from "@/lib/hearings/brief";
import type { Sweep } from "@/lib/jobs/schedule";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { sendHearingBriefEmail } from "@flyee/email";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The brief of each hearing, two business days before (migration 0187): written by ONE from the case, e-mailed to who
 * goes to it where an e-mail can leave ONE, kept on the hearing, and told on their WhatsApp as the firm's template
 * (0188). Once a hearing passed its time with nothing said of it, ONE asks who went for the result (0188), whose
 * answer the conversation's turn reads (`takeHearingReport`). Counts only.
 */

const todayInBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** Writes a message of a hearing to who goes (0188) and sends it at once; the outbox's sweep sends what is left. */
async function tellStaff(
  service: SupabaseClient,
  hearingId: string,
  kind: "hearing_brief" | "hearing_result",
  params: string[],
): Promise<"queued" | "skipped" | "failed"> {
  const { data, error } = await service.rpc("reserve_hearing_staff_message", {
    target_hearing: hearingId,
    target_kind: kind,
    target_params: params,
  });
  if (error) return "failed";
  const answer = (data ?? {}) as { code?: string; message_id?: unknown };
  if (answer.code !== "queued" || typeof answer.message_id !== "string") return "skipped";
  try {
    await deliverOutbox(service, { messageId: answer.message_id });
  } catch {
    // Queued: the outbox's sweep sends it.
  }
  return "queued";
}

export async function writeBriefs(service: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("hearing_briefs_owed", { target_limit: 30 });
  if (error) throw new Error("hearing_briefs_owed failed");
  const today = todayInBrasilia();
  let written = 0;
  let emailed = 0;
  let told = 0;
  for (const facts of briefFactsOf(data)) {
    if (!briefDue(facts, today)) continue;
    const lines = briefLines(facts);
    const { data: firm } = await service.from("organizations").select("name").eq("id", facts.orgId).maybeSingle();
    let sent = false;
    if (facts.attendeeEmail && process.env.RESEND_API_KEY) {
      const result = await sendHearingBriefEmail(facts.attendeeEmail, {
        locale: "pt-BR",
        firmName: String((firm as { name?: unknown } | null)?.name ?? ""),
        caseSeq: facts.caseSeq,
        whenLabel: whenLabel(facts),
        lines,
      }).catch(() => ({ sent: false }));
      sent = (result as { sent?: boolean }).sent === true;
    }
    const { error: recordError } = await service.rpc("record_hearing_brief", {
      target_hearing: facts.hearingId,
      target_body: lines.join("\n"),
      target_emailed: sent,
    });
    if (recordError) continue;
    written += 1;
    if (sent) emailed += 1;
    if ((await tellStaff(service, facts.hearingId, "hearing_brief", staffParams(facts))) === "queued") told += 1;
  }
  return { written, emailed, told };
}

/** Asks who went to each hearing that passed its time with nothing said of it how it went (0188). */
export async function askHearingResults(service: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("hearing_results_owed", { target_limit: 30 });
  if (error) throw new Error("hearing_results_owed failed");
  let asked = 0;
  let skipped = 0;
  for (const row of (Array.isArray(data) ? data : []) as Record<string, unknown>[]) {
    if (typeof row.hearing_id !== "string" || typeof row.starts_at !== "string") continue;
    const outcome = await tellStaff(
      service,
      row.hearing_id,
      "hearing_result",
      staffParams({
        attendeeName: typeof row.attendee_name === "string" ? row.attendee_name : null,
        kind: String(row.kind ?? "conciliacao"),
        caseSeq: Number(row.case_seq) || 0,
        startsAt: row.starts_at,
        timeZone: typeof row.time_zone === "string" ? row.time_zone : "America/Sao_Paulo",
      }),
    );
    if (outcome === "queued") asked += 1;
    else skipped += 1;
  }
  return { asked, skipped };
}

export const hearingBriefSweeps: Sweep[] = [
  {
    // The brief of each hearing two business days before (0187): the clock's only, each written once.
    key: "hearing-briefs",
    when: { every: 30 },
    run: async (service) => writeBriefs(service),
  },
  {
    // The result of a hearing asked of who went, an hour after it started (0188); also while ONE is used.
    key: "hearing-results",
    when: { every: 15 },
    whileUsed: true,
    run: async (service) => askHearingResults(service),
  },
];
