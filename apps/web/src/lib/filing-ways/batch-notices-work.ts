import "server-only";

import {
  batchStopKey,
  type BatchStopKind,
  batchStopParams,
  CODE_WAIT_MINUTES,
  toldStop,
} from "@/lib/filing-ways/batch-notices";
import { notifyLocalized } from "@/lib/notifications";
import { deliverOutbox } from "@/lib/whatsapp/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tells the lawyer of a batch of ONE's browser that it stopped for them (migration 0284), the moment it stopped: the
 * stop kept once (`reserve_filing_batch_notice`, which also writes the firm's template to their WhatsApp, or says why
 * it could not), the bell rung with the way to /protocolo, and the message sent at once (the outbox's sweep sends what
 * is left). Never throws: a notice that could not go leaves the batch as it is, and /protocolo says the stop anyway.
 */
export async function tellBatchStop(
  service: SupabaseClient,
  input: {
    batchId: string;
    personId: string;
    systemName: string;
    kind: BatchStopKind;
    /** Which stop: when the code was asked, the filing held, or the batch itself. */
    subject: string;
    codeKind?: "app" | "email";
  },
): Promise<"told" | "already" | "not_told"> {
  try {
    const { data: person } = await service
      .from("profiles")
      .select("display_name")
      .eq("id", input.personId)
      .maybeSingle();
    const name = String((person as { display_name?: string | null } | null)?.display_name ?? "");
    const kept = await service.rpc("reserve_filing_batch_notice", {
      target_batch: input.batchId,
      target_kind: input.kind,
      target_subject: input.subject,
      target_params: batchStopParams({
        name,
        systemName: input.systemName,
        kind: input.kind,
        codeKind: input.codeKind,
      }),
    });
    if (kept.error) return "not_told";
    const answer = (kept.data ?? {}) as { code?: string; message_id?: unknown; user_id?: unknown };
    if (answer.code === "already") return "already";
    if (answer.code !== "queued" && answer.code !== "skipped") return "not_told";
    const userId = typeof answer.user_id === "string" ? answer.user_id : input.personId;
    await notifyLocalized(
      [userId],
      (copy) =>
        input.kind === "code"
          ? copy.filingBatchCode(input.systemName, input.codeKind === "email", CODE_WAIT_MINUTES)
          : input.kind === "confirm"
            ? copy.filingBatchConfirm(input.systemName)
            : copy.filingBatchStopped(input.systemName),
      { type: "team", href: "/protocolo", sourceKey: batchStopKey(input.batchId, input.kind, input.subject) },
    );
    if (answer.code === "queued" && typeof answer.message_id === "string") {
      await deliverOutbox(service, { messageId: answer.message_id }).catch(() => undefined);
    }
    return "told";
  } catch {
    return "not_told";
  }
}

/** A batch ONE's browser stopped with why: told to its lawyer unless a person of the firm asked the stop. */
export async function tellBatchStopped(
  service: SupabaseClient,
  batch: { batchId: string; personId: string; systemName: string },
  why: string | null,
): Promise<void> {
  if (!toldStop(why)) return;
  await tellBatchStop(service, { ...batch, kind: "stopped", subject: batch.batchId });
}
