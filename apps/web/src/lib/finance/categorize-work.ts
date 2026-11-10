import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import { CATEGORIZE_TASK, categorizeBriefing, categorizeFailure, categorizeInputOf } from "@/lib/finance/categorize";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE's reading of a statement's lines by the AI (migration 0128): the lines no rule decided are handed, a few dozen
 * at a time, to the task that says each one's category; the database reads the run's answer and decides what is an
 * entry (a sure answer, where the firm lets ONE) and what is a suggestion for a person. Nothing here says what the
 * model answered: the worker names the run. Only ids leave this file.
 */

/** Whether a run would find a model here: the provider its instructions name has a key, or the test provider stands in. */
export async function categorizeReady(service: SupabaseClient): Promise<boolean> {
  const readiness = providerReadiness();
  if (readiness.fake) return true;
  const { data, error } = await service
    .from("prompt_versions")
    .select("provider")
    .eq("task", CATEGORIZE_TASK)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  return (readiness.configured as Record<string, boolean>)[String(data.provider)] === true;
}

const OUTCOMES = ["done", "retry", "failed", "released"] as const;
export type CategorizeOutcome = (typeof OUTCOMES)[number] | "not_held" | "in_course" | "none";

/** Claims the statement that waits the longest and has the AI read its lines; `none` when nothing waits. */
export async function categorizeNext(service: SupabaseClient): Promise<CategorizeOutcome> {
  const { data, error } = await service.rpc("claim_finance_categorization", { target_limit: 1 });
  if (error) throw new Error(`claim_finance_categorization failed: ${error.message}`);
  const held = ((data ?? []) as { statement_id: string; claim: number }[])[0];
  if (!held) return "none";
  return categorizeClaimed(service, held.statement_id, Number(held.claim));
}

/** Has the AI read the lines of a claimed statement, and records what came of it. Never throws for what a model did. */
export async function categorizeClaimed(
  service: SupabaseClient,
  statementId: string,
  claim: number,
): Promise<CategorizeOutcome> {
  const { data, error } = await service.rpc("finance_lines_to_categorize", {
    target_statement: statementId,
    target_claim: claim,
  });
  if (error) throw new Error(`finance_lines_to_categorize failed: ${error.message}`);
  const input = categorizeInputOf(data);
  if (!input) return "not_held";

  const record = async (
    outcome: "done" | "retry" | "released" | "failed",
    runId: string | null = null,
    code: string | null = null,
  ): Promise<CategorizeOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_finance_categorization", {
      target_statement: statementId,
      target_claim: claim,
      target_outcome: outcome,
      target_run: runId,
      target_code: code,
    });
    if (recordError) throw new Error(`record_finance_categorization failed: ${recordError.message}`);
    const said = String((recorded as { code?: unknown } | null)?.code ?? "");
    return OUTCOMES.find((known) => known === said) ?? "not_held";
  };

  // Nothing to read (every line was decided meanwhile): the statement is done.
  if (input.lines.length === 0) return record("done", null);

  const briefing = categorizeBriefing(input);
  const result = await runFirmTask({
    orgId: input.orgId,
    task: CATEGORIZE_TASK,
    // Hashed for the record: what the model was handed, never kept as text by the run.
    input: { briefing },
    messages: [{ role: "user", content: briefing }],
    subject: { type: "finance_statement", id: statementId },
    idempotencyKey: `extrato:${statementId}:${claim}`,
  });
  if (result.kind === "refused") return record(categorizeFailure(result.code), null, result.code);
  if (result.kind === "failed") return record(categorizeFailure(result.code), result.runId, result.code);
  if (result.kind === "replayed" && result.status === "running") return "in_course";
  if (result.kind === "replayed" && result.status !== "succeeded") return record("retry", null, "run_failed");
  return record("done", result.runId);
}

/** A round of the reading: statements one at a time until nothing waits, a model is out, or the time is up. */
export async function categorizeRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!(await categorizeReady(service))) return { skipped: 1 };
  for (let turn = 0; turn < 20 && Date.now() < until; turn += 1) {
    const outcome = await categorizeNext(service);
    if (outcome === "none") break;
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    if (outcome === "released") break;
  }
  return counts;
}

/** Right after a statement is finished: ONE reads what no rule decided, never waited for by the person. */
export function queueFinanceCategorization(): void {
  soon("finance-categorize", async () => {
    await categorizeRound(createServiceClient(), Date.now() + 120_000);
  });
}
