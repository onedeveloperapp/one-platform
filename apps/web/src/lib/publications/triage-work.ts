import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import { TRIAGE_TASK, triageBriefing, triageFailure, triageText } from "@/lib/publications/publications";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The shadow triage of a publication (migration 0028): the AI says what the
 * publication is, and its answer is kept beside the publication, out of the
 * firm's sight, to be compared with what a person says. It decides nothing
 * and asks nobody anything.
 *
 * Nothing here says what the model answered: the worker names the run, and
 * the database reads the run's own answer. Only ids leave this file.
 */

/**
 * Whether a run of the triage would find a model in this environment: the
 * provider its instructions in force name has a key (or the test provider
 * stands in). Without one nothing is claimed: a publication is left to be
 * classified when there is a model to ask, never marked as one that failed.
 */
export async function triageReady(service: SupabaseClient): Promise<boolean> {
  const readiness = providerReadiness();
  if (readiness.fake) return true;
  const { data, error } = await service
    .from("prompt_versions")
    .select("provider")
    .eq("task", TRIAGE_TASK)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  return (readiness.configured as Record<string, boolean>)[String(data.provider)] === true;
}

/** A publication the sweep holds, with the number of the claim. */
export type TriageClaim = { publicationId: string; claim: number };

export async function claimPublicationTriage(
  service: SupabaseClient,
  limit = 1,
  publicationId: string | null = null,
): Promise<TriageClaim[]> {
  const { data, error } = await service.rpc("claim_publication_triage", {
    target_limit: limit,
    target_publication: publicationId,
  });
  if (error) throw new Error(`claim_publication_triage failed: ${error.message}`);
  return ((data ?? []) as { publication_id: string; claim: number }[]).map((row) => ({
    publicationId: row.publication_id,
    claim: Number(row.claim),
  }));
}

/**
 * Claims the publication that waits the longest and asks the AI what it is:
 * one piece of work, so a claim is never held while its worker waits in a
 * line for its turn. `none` when nothing waits.
 */
export async function triageNext(service: SupabaseClient): Promise<TriageOutcome | "none"> {
  const held = (await claimPublicationTriage(service, 1))[0];
  return held ? triageClaimedPublication(service, held) : "none";
}

type PublicationToTriage = {
  publication_id: string;
  org_id: string;
  claim: number;
  court: string;
  kind: string;
  document_type: string | null;
  class_name: string | null;
  body: string;
  truncated: boolean;
};

const OUTCOMES = ["done", "retry", "failed", "released"] as const;
/**
 *   done      the AI's answer is kept beside the publication;
 *   retry     the model answered badly for this text: tried again after a wait, a few times;
 *   failed    final for this publication;
 *   released  nothing was learned of the publication (the provider is out, a key was refused):
 *             the try does not count; when the next one meets the same, the sweep stops for now;
 *   not_held  the claim is no longer this worker's;
 *   in_course the run of this very claim is still running elsewhere (a step that ran twice).
 */
export type TriageOutcome = (typeof OUTCOMES)[number] | "not_held" | "in_course";

/** Asks the AI what a claimed publication is and records what came of it. Never throws for what a model did. */
export async function triageClaimedPublication(service: SupabaseClient, held: TriageClaim): Promise<TriageOutcome> {
  const { data, error } = await service.rpc("publication_to_triage", {
    target_publication: held.publicationId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`publication_to_triage failed: ${error.message}`);
  const row = ((data ?? []) as PublicationToTriage[])[0];
  if (!row) return "not_held";

  const record = async (
    outcome: "done" | "retry" | "released",
    input: { runId?: string | null; code?: string | null } = {},
  ): Promise<TriageOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_publication_triage", {
      target_publication: row.publication_id,
      target_claim: row.claim,
      target_outcome: outcome,
      target_run: input.runId ?? null,
      target_code: input.code ?? null,
    });
    if (recordError) throw new Error(`record_publication_triage failed: ${recordError.message}`);
    // What was recorded is what the database says: it is the one that knows whether a try was the last.
    const answer = String((recorded as { code?: string } | null)?.code ?? "");
    return OUTCOMES.find((code) => code === answer) ?? "not_held";
  };
  /** A failure, said as what it says of the publication: a try of its own, or nothing at all. */
  const failed = (code: string, runId: string | null = null) => record(triageFailure(code), { runId, code });

  const facts = {
    court: row.court,
    kind: row.kind,
    documentType: row.document_type,
    className: row.class_name,
    body: row.body,
    truncated: Boolean(row.truncated),
  };
  const result = await runFirmTask({
    orgId: row.org_id,
    task: TRIAGE_TASK,
    // Hashed for the record: what the model was handed, never kept as text by the run.
    input: { ...facts, body: triageText(row.body) },
    messages: [{ role: "user", content: triageBriefing(facts) }],
    subject: { type: "publication", id: row.publication_id },
    idempotencyKey: `triagem:${row.publication_id}:${row.claim}`,
  });

  if (result.kind === "refused") return failed(result.code);
  if (result.kind === "failed") return failed(result.code, result.runId);
  if (result.kind === "replayed" && result.status === "running") return "in_course";
  // Its first run had ended without a word: nothing is known of the publication, and the next claim is another run.
  if (result.kind === "replayed" && result.status !== "succeeded") return failed("run_failed");
  return record("done", { runId: result.runId });
}
