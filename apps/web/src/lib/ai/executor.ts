import "server-only";

import { supabaseRunStore } from "@/lib/ai/run-store";
import { configuredProviders, getChatProvider } from "@flyee/ai";
import { FakeChatProvider } from "@flyee/ai/fake";
import { runAiTask, type RunRequest, type RunResult } from "@flyee/ai/runs";
import type { AiProviderName, ChatProvider } from "@flyee/ai/types";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Runs a task of the platform for a firm: the one entry point of the app into
 * the executor (`@flyee/ai/runs`). It builds the store over the service role
 * and never lets that client out: a task receives its input and gives back an
 * answer, nothing else.
 *
 * The provider is the one the prompt version names, when this environment has
 * its key. A provider with no key is a recorded failure, never a silent switch
 * to another: a prompt is written and measured for one model.
 *
 * With `AI_FAKE_PROVIDER=1` the fake provider stands in for all of them, so a
 * development machine or a preview waits for no key. Its runs are recorded
 * under the model name `fake`, and production never honours the switch: an
 * answer a lawyer approves there was written by a model.
 */
export function isFakeProviderOn(): boolean {
  return process.env.AI_FAKE_PROVIDER === "1" && process.env.VERCEL_ENV !== "production";
}

function providerFor(name: AiProviderName): ChatProvider | null {
  if (isFakeProviderOn()) return new FakeChatProvider(name);
  return configuredProviders()[name] ? getChatProvider(name) : null;
}

/** What a run of each provider would find in this environment: for the operator's console. */
export function providerReadiness(): { fake: boolean; configured: Record<AiProviderName, boolean> } {
  return { fake: isFakeProviderOn(), configured: configuredProviders() };
}

/** Never throws for what a model did. Returns `refused` when the backend has no service key at all. */
export async function runFirmTask(request: RunRequest): Promise<RunResult> {
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { kind: "refused", code: "backend_not_configured" };
  }
  try {
    return await runAiTask({ store: supabaseRunStore(service), provider: providerFor }, request);
  } catch (error) {
    console.error("ai_run_failed", {
      task: request.task,
      orgId: request.orgId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "refused", code: "store_unavailable" };
  }
}
