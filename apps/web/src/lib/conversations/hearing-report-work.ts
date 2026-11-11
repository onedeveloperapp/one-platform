import "server-only";

import { runFirmTask } from "@/lib/ai/executor";
import { TRANSCRIPTION_TASK } from "@/lib/cases/statements";
import {
  HEARING_REPORT_TASK,
  pickHearing,
  reportBriefing,
  reportHearingsOf,
  reportRecordedMessage,
  reportUnreadMessage,
  whichHearingMessage,
} from "@/lib/conversations/hearing-report";
import { settleDeadlineCount } from "@/lib/deadlines/count-work";
import { supabaseFileStore } from "@/lib/files/store";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The report of a hearing by who went (migration 0187): in a turn of a conversation the backend holds, a member of
 * the firm by the WhatsApp of their profile, or an attendee from outside by the one on the hearing, with a hearing of
 * theirs and nothing said of it, has what they sent read as the result: an audio transcribed first, the result read by
 * the task `audiencia.resultado`, and recorded by the database, which reads the run. Anybody else is answered as usual.
 */

type Held = { conversationId: string; claim: number };
type Say = (body: string) => Promise<void>;

async function rpc(service: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name} failed`);
  return (data ?? {}) as Record<string, unknown>;
}

/** An audio the person sent in this turn, transcribed; the media is left out of any case. */
async function transcribedAudio(service: SupabaseClient, held: Held, orgId: string): Promise<string> {
  const listed = await rpc(service, "conversation_media_to_join", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  }).catch(() => ({}) as Record<string, unknown>);
  const items = Array.isArray(listed.items) ? (listed.items as Record<string, unknown>[]) : [];
  const words: string[] = [];
  for (const item of items) {
    const messageId = typeof item.message_id === "string" ? item.message_id : null;
    if (!messageId) continue;
    const path = typeof item.storage_path === "string" ? item.storage_path : null;
    const mime = typeof item.mime === "string" ? item.mime : null;
    if (item.kind === "audio" && path && mime) {
      const audio = await supabaseFileStore(service).get(path);
      if (audio) {
        const run = await runFirmTask({
          orgId,
          task: TRANSCRIPTION_TASK,
          input: { sha256: typeof item.sha256 === "string" ? item.sha256 : "" },
          messages: [
            {
              role: "user",
              content: "Transcreva o áudio anexo e responda com o objeto pedido.",
              attachments: [{ kind: "audio", mime, dataBase64: Buffer.from(audio).toString("base64") }],
            },
          ],
          subject: { type: "wa_message", id: messageId },
          idempotencyKey: `relato-audiencia:${messageId}`,
        });
        const text = run.kind === "finished" ? (run.output as { texto?: unknown } | null)?.texto : null;
        if (typeof text === "string" && text.trim()) words.push(text.trim());
      }
    }
    // A file of a report never joins a case.
    await rpc(service, "one_join_conversation_media", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_message: messageId,
      target_kind: "left",
      target_name: null,
    }).catch(() => undefined);
  }
  return words.join("\n");
}

/**
 * Whether this turn is a hearing's report, and then it is taken whole: true when ONE answered it (recorded, asked which
 * hearing, or said it could not tell), false for anybody else, who is answered as usual.
 */
export async function takeHearingReport(
  service: SupabaseClient,
  held: Held,
  context: { orgId: string },
  words: string[],
  say: Say,
): Promise<boolean> {
  const found = await rpc(service, "conversation_hearing_report", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  }).catch(() => ({ code: "none" }) as Record<string, unknown>);
  if (found.code !== "one" && found.code !== "many") return false;
  const hearings = reportHearingsOf(found.hearings);
  const hearing = found.code === "one" ? (hearings[0] ?? null) : pickHearing(hearings, words);
  const audio = await transcribedAudio(service, held, context.orgId);
  const text = [words.join("\n"), audio].filter(Boolean).join("\n").trim();
  if (!hearing) {
    await say(whichHearingMessage(hearings));
    return true;
  }
  if (!text) return false;
  const run = await runFirmTask({
    orgId: context.orgId,
    task: HEARING_REPORT_TASK,
    input: { hearing: hearing.hearingId, text },
    messages: [{ role: "user", content: reportBriefing(hearing, text) }],
    subject: { type: "hearing", id: hearing.hearingId },
    idempotencyKey: `audiencia:${held.conversationId}:${held.claim}`,
  });
  if (run.kind !== "finished") {
    await say(reportUnreadMessage);
    return true;
  }
  const recorded = await rpc(service, "record_hearing_report", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_hearing: hearing.hearingId,
    target_run: run.runId,
  }).catch(() => ({ ok: false }) as Record<string, unknown>);
  if (!recorded.ok || recorded.result === "nao_sei") {
    await say(reportUnreadMessage);
    return true;
  }
  if (typeof recorded.deadline_id === "string") await settleDeadlineCount(recorded.deadline_id).catch(() => undefined);
  await say(
    reportRecordedMessage({
      caseSeq: hearing.caseSeq,
      result: String(recorded.result ?? ""),
      cents: typeof recorded.cents === "number" ? recorded.cents : null,
      payDays: typeof recorded.pay_days === "number" ? recorded.pay_days : null,
    }),
  );
  return true;
}
