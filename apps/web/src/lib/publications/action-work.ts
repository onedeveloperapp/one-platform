import "server-only";

import { providerReadiness, runFirmTask } from "@/lib/ai/executor";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { PUBLICATION_ACTION_TASK } from "@/lib/publications/actions-read";
import { briefingLabel, triageText } from "@/lib/publications/publications";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of what a publication asks (migration 0186, item 4.1 of the case journey plan): each triaged
 * publication of a case read by the task `publicacao.acao` (a summary for the firm and one for the client, one action
 * of a fixed list, what each side owes), the database reading the run's answer and keeping only what fits the list.
 * Only ids leave this file.
 */

async function ready(service: SupabaseClient): Promise<boolean> {
  const readiness = providerReadiness();
  if (readiness.fake) return true;
  const { data, error } = await service
    .from("prompt_versions")
    .select("provider")
    .eq("task", PUBLICATION_ACTION_TASK)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  return (readiness.configured as Record<string, boolean>)[String(data.provider)] === true;
}

/** What the model is told: the triage and the publication's text, fenced as content to read. */
export function actionBriefing(input: {
  category: string | null;
  kind: string | null;
  documentType: string | null;
  body: string;
}) {
  return [
    `Categoria da triagem: ${briefingLabel(input.category ?? "")}`,
    `Tipo da comunicação: ${briefingLabel(input.kind ?? "")}`,
    input.documentType ? `Tipo do documento: ${briefingLabel(input.documentType)}` : null,
    "Texto da publicação, entre <<< e >>>:",
    "<<<",
    triageText(input.body),
    ">>>",
  ]
    .filter(Boolean)
    .join("\n");
}

type Outcome = "done" | "retry" | "released" | "not_held";

async function readClaimed(service: SupabaseClient, actionId: string, claim: number): Promise<Outcome> {
  const { data, error } = await service.rpc("publication_action_to_write", {
    target_action: actionId,
    target_claim: claim,
  });
  if (error) throw new Error("publication_action_to_write failed");
  const held = (data ?? {}) as {
    ok?: boolean;
    org_id?: unknown;
    category?: unknown;
    kind?: unknown;
    document_type?: unknown;
    body?: unknown;
  };
  if (!held.ok || typeof held.org_id !== "string" || typeof held.body !== "string") return "not_held";
  const record = async (outcome: Exclude<Outcome, "not_held">, runId: string | null = null): Promise<Outcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_publication_action", {
      target_action: actionId,
      target_claim: claim,
      target_outcome: outcome,
      target_run: runId,
    });
    if (recordError) throw new Error("record_publication_action failed");
    const said = String((recorded as { code?: unknown } | null)?.code ?? "");
    return (["done", "retry", "released"] as const).find((known) => known === said) ?? "not_held";
  };
  const briefing = actionBriefing({
    category: typeof held.category === "string" ? held.category : null,
    kind: typeof held.kind === "string" ? held.kind : null,
    documentType: typeof held.document_type === "string" ? held.document_type : null,
    body: held.body,
  });
  const result = await runFirmTask({
    orgId: held.org_id,
    task: PUBLICATION_ACTION_TASK,
    input: { briefing },
    messages: [{ role: "user", content: briefing }],
    subject: { type: "publication_action", id: actionId },
    idempotencyKey: `acao:${actionId}:${claim}`,
  });
  if (result.kind === "refused") return record("released");
  if (result.kind === "failed") return record("retry", result.runId);
  if (result.kind === "replayed" && result.status !== "succeeded") return record("retry");
  return record("done", result.runId);
}

/** A round: the readings owed, one at a time, until nothing waits, a model is out, or the time is up. */
export async function publicationActionsRound(service: SupabaseClient, until: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  if (!(await ready(service))) return { skipped: 1 };
  for (let turn = 0; turn < 20 && Date.now() < until; turn += 1) {
    const { data, error } = await service.rpc("claim_publication_actions", { target_limit: 1 });
    if (error) throw new Error("claim_publication_actions failed");
    const held = ((data ?? []) as { action_id: string; claim: number }[])[0];
    if (!held) break;
    const outcome = await readClaimed(service, held.action_id, Number(held.claim)).catch(() => "retry" as const);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    if (outcome === "released") break;
  }
  return counts;
}

/** Right after a publication was triaged: what it asks is read now, never waited for. */
export function queuePublicationActions(): void {
  soon("publication-actions", async () => {
    await publicationActionsRound(createServiceClient(), Date.now() + 120_000);
  });
}

export const publicationActionSweeps: Sweep[] = [
  {
    // What each triaged publication of a case asks (0186): also while ONE is used, since each is claimed under a number.
    key: "publication-actions",
    // Its work is a model's: it waits while the provider of these tasks refuses the platform's AI account (0255).
    ai: [PUBLICATION_ACTION_TASK],
    when: { every: 10 },
    whileUsed: true,
    run: (service, until) => publicationActionsRound(service, until),
  },
];
