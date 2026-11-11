import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import { queueDraftWork } from "@/lib/cases/drafts-work";
import { factsAskedMessage, factsReminderMessage, PIECE_FACTS_TASK } from "@/lib/cases/piece-facts";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the client's check of the facts of the initial (migration 0182): the facts of a ready piece
 * written in plain words by the AI (the database hands the piece with every identifier under a mark, and reads the
 * answer from the run, putting the names back), the client told in the conversation ONE holds and reminded once,
 * and, once the client confirms, ONE's own approval of a piece it may approve. Only ids leave this file.
 */

/** Whether a run would find a model here. */
async function factsReady(service: SupabaseClient): Promise<boolean> {
  const readiness = providerReadiness();
  if (readiness.fake) return true;
  const { data, error } = await service
    .from("prompt_versions")
    .select("provider")
    .eq("task", PIECE_FACTS_TASK)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  return (readiness.configured as Record<string, boolean>)[String(data.provider)] === true;
}

type Outcome = "done" | "retry" | "failed" | "released" | "not_held";

/** Writes the facts of one claimed check, and records what came of it. Never throws for what a model did. */
async function writeClaimed(service: SupabaseClient, checkId: string, claim: number): Promise<Outcome> {
  const { data, error } = await service.rpc("piece_fact_check_to_write", {
    target_check: checkId,
    target_claim: claim,
  });
  if (error) throw new Error("piece_fact_check_to_write failed");
  const held = (data ?? {}) as { ok?: boolean; org_id?: unknown; text?: unknown };
  if (!held.ok || typeof held.org_id !== "string" || typeof held.text !== "string") return "not_held";
  const record = async (outcome: Exclude<Outcome, "not_held">, runId: string | null = null): Promise<Outcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_piece_fact_check", {
      target_check: checkId,
      target_claim: claim,
      target_outcome: outcome,
      target_run: runId,
    });
    if (recordError) throw new Error("record_piece_fact_check failed");
    const said = String((recorded as { code?: unknown } | null)?.code ?? "");
    return (["done", "retry", "failed", "released"] as const).find((known) => known === said) ?? "not_held";
  };
  const result = await runFirmTask({
    orgId: held.org_id,
    task: PIECE_FACTS_TASK,
    input: { piece: held.text },
    messages: [{ role: "user", content: held.text }],
    subject: { type: "piece_fact_check", id: checkId },
    idempotencyKey: `fatos:${checkId}:${claim}`,
  });
  if (result.kind === "refused") {
    return record(result.code === "provider_unavailable" || result.code === "no_key" ? "released" : "retry");
  }
  if (result.kind === "failed") return record("retry", result.runId);
  if (result.kind === "replayed" && result.status !== "succeeded") return record("retry");
  return record("done", result.runId);
}

/** ONE tells the client in the conversation it holds that the facts wait for them, and reminds them once. */
async function tellClients(service: SupabaseClient): Promise<number> {
  const { data, error } = await service.rpc("piece_fact_messages_owed", { target_limit: 20 });
  if (error) throw new Error("piece_fact_messages_owed failed");
  let told = 0;
  for (const row of (data ?? []) as { check_id: string; first_name: string | null; kind: string }[]) {
    const body =
      row.kind === "reminder" ? factsReminderMessage(row.first_name ?? "") : factsAskedMessage(row.first_name ?? "");
    const written = await service.rpc("one_say_piece_facts", {
      target_check: row.check_id,
      target_kind: row.kind,
      target_body: body,
    });
    const answer = (written.data ?? {}) as { ok?: boolean; message_id?: unknown };
    if (written.error || !answer.ok) continue;
    told += 1;
    if (typeof answer.message_id === "string") {
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    }
  }
  return told;
}

/** A round: the checks owed written one at a time, then the clients told. */
export async function pieceFactsRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (await factsReady(service)) {
    for (let turn = 0; turn < 10 && Date.now() < until; turn += 1) {
      const { data, error } = await service.rpc("claim_piece_fact_checks", { target_limit: 1 });
      if (error) throw new Error("claim_piece_fact_checks failed");
      const held = ((data ?? []) as { check_id: string; claim: number }[])[0];
      if (!held) break;
      const outcome = await writeClaimed(service, held.check_id, Number(held.claim)).catch(() => "retry" as const);
      counts[outcome] = (counts[outcome] ?? 0) + 1;
      if (outcome === "released") break;
    }
  }
  counts.told = await tellClients(service).catch(() => 0);
  return counts;
}

/** Right after a piece became ready, or the client answered: the work owed is done now, never waited for. */
export function queuePieceFacts(draftId: string | null = null): void {
  soon("piece-facts", async () => {
    const service = createServiceClient();
    if (draftId) {
      // A piece the client confirmed is ONE's to approve where the firm lets it, and its document follows.
      await service.rpc("approve_case_draft_unattended", { target_draft: draftId }).then(
        () => undefined,
        () => undefined,
      );
      await queueDraftWork(draftId);
    }
    await pieceFactsRound(service, Date.now() + 120_000);
  });
}
