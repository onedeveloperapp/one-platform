import type { FinishedRun, FinishRunInput, RunPrompt, RunStore, StartedRun, StartRunInput } from "@flyee/ai/runs";
import {
  type AiProviderName,
  type AssistantConfig,
  type ChatMessage,
  type ChatProvider,
  type ChatUsage,
  reportUsage,
  type StructuredOutput,
  type UsageSink,
} from "@flyee/ai/types";

/**
 * The model a fake call reports as the one that answered. A run made with the
 * fake provider is recorded under this name, never under the model it stood in
 * for: nobody reads it later as an answer of that model, and no price list
 * charges it as one.
 */
export const FAKE_MODEL = "fake";

/**
 * A provider that answers from the schema, with no network and no key.
 *
 * It stands in for whichever provider a prompt version names, in tests and on
 * a machine with no API key (the app uses it only when `AI_FAKE_PROVIDER=1`,
 * and never in production). The answer is deterministic: the same schema and
 * the same messages give the same object and the same usage, so a test can
 * assert on both.
 */
export class FakeChatProvider implements ChatProvider {
  readonly name: AiProviderName;
  /** Every structured call it received, in order. */
  readonly calls: { config: AssistantConfig; messages: ChatMessage[]; output: StructuredOutput }[] = [];
  private readonly answer: ((output: StructuredOutput, messages: ChatMessage[]) => unknown) | null;
  private failure: unknown = null;
  /** Set to false to stand in for a provider that cannot be sent a PDF. */
  readsDocuments = true;
  /** Set to false to stand in for a provider that cannot be sent an audio. */
  readsAudio = true;

  constructor(
    name: AiProviderName = "anthropic",
    answer: ((output: StructuredOutput, messages: ChatMessage[]) => unknown) | null = null,
  ) {
    this.name = name;
    this.answer = answer;
  }

  /** The next call throws this instead of answering (a provider that is down, a refusal). */
  failNextWith(error: unknown): void {
    this.failure = error;
  }

  /** Hears audio by default, so the path of a transcription runs on a machine with no key; a test turns it off. */
  supportsAudio(): boolean {
    return this.readsAudio;
  }

  /** Reads documents by default, as the providers the tasks are written for do; a test turns it off. */
  supportsDocuments(): boolean {
    return this.readsDocuments;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const text = "Resposta do provedor de teste.";
    reportUsage(onUsage, usageOf(config, messages, text));
    yield text;
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown> {
    this.calls.push({ config, messages, output });
    if (this.failure !== null) {
      const error = this.failure;
      this.failure = null;
      throw error;
    }
    const answer = this.answer ? this.answer(output, messages) : fromSchema(output.schema);
    reportUsage(onUsage, usageOf(config, messages, JSON.stringify(answer)));
    return answer;
  }
}

/** Roughly four characters a token: enough for a cost that is stable and not zero. */
function usageOf(config: AssistantConfig, messages: ChatMessage[], answer: string): ChatUsage {
  const asked = config.systemPrompt.length + messages.reduce((sum, message) => sum + message.content.length, 0);
  return { tokensIn: Math.ceil(asked / 4), tokensOut: Math.ceil(answer.length / 4), model: FAKE_MODEL };
}

/** An object that fits a JSON Schema: every property filled with a value of its type. */
function fromSchema(schema: Record<string, unknown>): unknown {
  const type = schema.type;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (type === "object") {
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, fromSchema(value)]));
  }
  if (type === "array") return [];
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "null") return null;
  return typeof schema.description === "string" ? `Resposta de teste: ${schema.description}` : "Resposta de teste.";
}

type StoredRun = StartRunInput & {
  runId: string;
  status: "running" | "succeeded" | "failed" | "blocked";
  output: Record<string, unknown> | null;
  usage: ChatUsage | null;
  errorCode: string | null;
  approvalId: string | null;
};

export type FakeTask = {
  prompt: RunPrompt;
  /** Whether a succeeded answer waits for a person. */
  needsApproval: boolean;
};

/**
 * The run store, in memory, with the rules of the real one (migration
 * 0016_ai_runs) that the executor depends on: a task needs instructions in
 * force, the same idempotency key is one run, a run is finished once, and a
 * succeeded answer enters the queue when the task asks for a person.
 */
export class FakeRunStore implements RunStore {
  readonly runs: StoredRun[] = [];
  private readonly tasks: Map<string, FakeTask>;
  /** Dollars per million tokens, by model: `[input, output]`. A model left out is unpriced. */
  private readonly prices: Map<string, [number, number]>;
  private sequence = 0;

  constructor(tasks: Record<string, FakeTask>, prices: Record<string, [number, number]> = {}) {
    this.tasks = new Map(Object.entries(tasks));
    this.prices = new Map(Object.entries(prices));
  }

  async start(input: StartRunInput): Promise<StartedRun> {
    const task = this.tasks.get(input.task);
    if (!task) return { kind: "refused", code: "unknown_task" };
    if (input.idempotencyKey) {
      const existing = this.runs.find((run) => run.orgId === input.orgId && run.idempotencyKey === input.idempotencyKey);
      if (existing) return { kind: "existing", runId: existing.runId, status: existing.status };
    }
    this.sequence += 1;
    const runId = `run-${this.sequence}`;
    this.runs.push({ ...input, runId, status: "running", output: null, usage: null, errorCode: null, approvalId: null });
    return { kind: "started", runId, prompt: task.prompt };
  }

  /** What the sweep does to a run nobody finished: closes it as failed, `abandoned`. */
  abandon(runId: string): void {
    const run = this.runs.find((entry) => entry.runId === runId);
    if (!run || run.status !== "running") return;
    run.status = "failed";
    run.errorCode = "abandoned";
  }

  async finish(input: FinishRunInput): Promise<FinishedRun> {
    const run = this.runs.find((entry) => entry.runId === input.runId);
    if (!run) throw new Error("run_not_found");
    const usage = input.usage ?? null;
    const price = usage ? this.prices.get(usage.model ?? "") : undefined;
    const cost = usage && price ? Math.round(usage.tokensIn * price[0] + usage.tokensOut * price[1]) : 0;
    // A run already closed keeps its status and its answer: only what the late
    // call consumed is still recorded.
    if (run.status !== "running") {
      run.usage = run.usage ?? usage;
      return { status: run.status, approvalId: run.approvalId, costUsdMicros: cost, priced: Boolean(price) };
    }
    run.status = input.status;
    run.output = input.status === "succeeded" ? (input.output ?? null) : null;
    run.usage = usage;
    run.errorCode = input.status === "succeeded" ? null : (input.errorCode ?? "failed");
    if (input.status === "succeeded" && this.tasks.get(run.task)?.needsApproval) {
      run.approvalId = `approval-${run.runId}`;
    }
    return { status: input.status, approvalId: run.approvalId, costUsdMicros: cost, priced: Boolean(price) };
  }
}
