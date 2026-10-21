import "server-only";

import type {
  FinishedRun,
  FinishRunInput,
  RunPrompt,
  RunStatus,
  RunStore,
  StartedRun,
  StartRunInput,
} from "@flyee/ai/runs";
import { AI_PROVIDERS, type AiProviderName } from "@flyee/ai/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The run store over the database (migration 0016_ai_runs): the two things
 * the executor may do to a run, each through the function that takes the
 * firm. It is built from the service-role client and hands the executor an
 * interface, never the client itself.
 *
 * The functions decide everything that is a rule: which instructions are in
 * force, that a requester belongs to the firm, that the same idempotency key
 * is one run, what the run cost and whether its answer waits for a person.
 */

type PromptRow = {
  version: number;
  provider: string;
  model: string;
  effort: string | null;
  system_prompt: string;
  output_schema: Record<string, unknown>;
  max_tokens: number;
};

type StartAnswer = { ok?: boolean; code?: string; run_id?: string; status?: string; prompt?: PromptRow };

type FinishAnswer = {
  ok?: boolean;
  code?: string;
  status?: string;
  approval_id?: string | null;
  cost_usd_micros?: number;
  priced?: boolean;
};

const isProvider = (value: string): value is AiProviderName => (AI_PROVIDERS as readonly string[]).includes(value);

const isRunStatus = (value: unknown): value is RunStatus =>
  value === "succeeded" || value === "failed" || value === "blocked";

function toPrompt(row: PromptRow): RunPrompt | null {
  if (!isProvider(row.provider)) return null;
  return {
    version: row.version,
    provider: row.provider,
    model: row.model,
    effort: row.effort,
    systemPrompt: row.system_prompt,
    outputSchema: row.output_schema,
    maxTokens: row.max_tokens,
  };
}

export function supabaseRunStore(service: SupabaseClient): RunStore {
  return {
    async start(input: StartRunInput): Promise<StartedRun> {
      const { data, error } = await service.rpc("start_ai_run", {
        target_org: input.orgId,
        target_task: input.task,
        target_input_hash: input.inputHash,
        target_requested_by: input.requestedBy ?? null,
        target_subject_type: input.subject?.type ?? null,
        target_subject_id: input.subject?.id ?? null,
        target_idempotency_key: input.idempotencyKey ?? null,
      });
      if (error) return { kind: "refused", code: "store_unavailable" };
      const answer = (data ?? {}) as StartAnswer;
      if (!answer.ok || !answer.run_id) return { kind: "refused", code: answer.code ?? "refused" };
      if (answer.code === "existing") {
        return { kind: "existing", runId: answer.run_id, status: answer.status ?? "running" };
      }
      const prompt = answer.prompt ? toPrompt(answer.prompt) : null;
      if (!prompt) return { kind: "refused", code: "invalid_prompt_version" };
      return { kind: "started", runId: answer.run_id, prompt };
    },

    async finish(input: FinishRunInput): Promise<FinishedRun> {
      const { data, error } = await service.rpc("finish_ai_run", {
        target_run: input.runId,
        target_status: input.status,
        target_output: input.status === "succeeded" ? (input.output ?? null) : null,
        target_tokens_in: input.usage?.tokensIn ?? 0,
        target_tokens_out: input.usage?.tokensOut ?? 0,
        target_model: input.usage?.model ?? null,
        target_error_code: input.errorCode ?? null,
      });
      // A run that could not be closed stays `running` until the sweep gives it
      // up (expire_stale_ai_runs): the caller must know it did not land.
      if (error) throw new Error(`finish_ai_run failed: ${error.message}`);
      const answer = (data ?? {}) as FinishAnswer;
      // The run is gone (its firm was deleted meanwhile) or the answer is not
      // one this code knows: either way nothing may be taken as recorded.
      if (!answer.ok || !isRunStatus(answer.status)) {
        throw new Error(`finish_ai_run refused: ${answer.code ?? "unknown"}`);
      }
      return {
        status: answer.status,
        approvalId: answer.approval_id ?? null,
        costUsdMicros: Number(answer.cost_usd_micros ?? 0),
        priced: Boolean(answer.priced),
      };
    },
  };
}
