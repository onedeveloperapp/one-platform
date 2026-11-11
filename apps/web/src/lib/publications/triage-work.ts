import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import { settleDeadlineCounts } from "@/lib/deadlines/count-work";
import { soon } from "@/lib/jobs/soon";
import { settleFirmNotices } from "@/lib/notices/work";
import { tellPublicationAcks } from "@/lib/publications/ack-notices";
import { queuePublicationActions } from "@/lib/publications/action-work";
import { TRIAGE_TASK, triageBriefing, triageFailure, triageText } from "@/lib/publications/publications";
import { queuePublicationReading } from "@/lib/publications/reading-work";
import { createServiceClient } from "@flyee/auth/service";
import { judgmentOf } from "@flyee/rules/judgment";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE's triage of a publication (migrations 0028, 0035 and 0104): the AI says
 * what the publication is and how sure it is, and the database decides what
 * that is: where the firm lets ONE triage, an answer it is sure of, of a
 * whole text nobody triaged, is the publication's triage, and the lawyer it
 * was addressed to is asked to say they are aware of it; anything else is
 * kept beside the publication, out of the firm's sight, for a person to
 * triage. What follows a triage ONE made is done right after, as after a
 * person's: whether a decision is the lawsuit's judgment (0107), then the
 * reading of a deadline or a hearing, the bell of the awareness and the
 * client's notices.
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

/** What follows a triage ONE made, asked for and never waited on: the sweeps reach it anyway. */
export type TriageFollow = (publicationId: string, orgId: string) => Promise<void>;

/**
 * Right after: the reading of a deadline or a hearing (0040), the bell of the awareness owed (0104) and the client's
 * notices (a payment's warning against the scam).
 */
const followTriageHere: TriageFollow = async (publicationId, orgId) => {
  await queuePublicationReading(publicationId);
  // What the publication asks, read by ONE right after its triage (0186).
  queuePublicationActions();
  soon("publication-acks", () => tellPublicationAcks(createServiceClient(), Date.now() + 20_000, publicationId));
  await settleFirmNotices(orgId);
};

/**
 * Whether a publication ONE just triaged is the lawsuit's judgment, read by the same rule a person's triage goes
 * through (`@flyee/rules/judgment`): what its type and its words say clearly is kept by the database, which keeps it
 * only of a decision ONE triaged that nobody said a word on (0107) and answers anything else with a refusal that
 * changes nothing. Words that say nothing clear leave the question to a person, as before.
 */
async function judgeTriagedDecision(service: SupabaseClient, row: PublicationToTriage): Promise<void> {
  const reading = judgmentOf({ documentType: row.document_type, text: row.body });
  if (reading === null) return;
  const { error } = await service.rpc("record_publication_judgment_rule", {
    target_publication: row.publication_id,
    target_judgment: reading,
  });
  if (error) throw new Error(`record_publication_judgment_rule failed: ${error.message}`);
  // A judgment proposes the terms the law gives it (0141): counted right after, so their day shows at once.
  if (reading) settleDeadlineCounts();
}

/**
 * Publications just arrived (the DJEN's capture, the test court): ONE triages them right after the answer, instead
 * of at the next sweep, so a hearing the court marked reaches the agenda and the client while it is still ahead.
 * Never waited for; where no model can be asked here, nothing is claimed.
 */
export async function queuePublicationTriage(): Promise<void> {
  soon("publication-triage", async () => {
    const service = createServiceClient();
    if (!(await triageReady(service))) return;
    const until = Date.now() + 60_000;
    for (let turn = 0; turn < 10 && Date.now() < until; turn += 1) {
      const outcome = await triageNext(service);
      if (outcome === "none" || outcome === "released") break;
    }
  });
}

/** Asks the AI what a claimed publication is and records what came of it. Never throws for what a model did. */
export async function triageClaimedPublication(
  service: SupabaseClient,
  held: TriageClaim,
  follow: TriageFollow = followTriageHere,
): Promise<TriageOutcome> {
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
    // What was recorded is what the database says: it is the one that knows whether a try was the last, and
    // whether the AI's answer is now the publication's triage.
    const answer = (recorded ?? {}) as { code?: string; applied?: boolean };
    const code = OUTCOMES.find((known) => known === String(answer.code ?? "")) ?? "not_held";
    if (code === "done" && answer.applied === true) {
      // Before what follows, so the case never asks a person what the decision's own words already say.
      await judgeTriagedDecision(service, row);
      await follow(row.publication_id, row.org_id);
    }
    return code;
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
