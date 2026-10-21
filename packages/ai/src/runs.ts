import { createHash } from "node:crypto";

import { isStructuredOutputError, providerFailureCode } from "@flyee/ai/errors";
import { type AiProviderName, type ChatMessage, type ChatProvider, type ChatUsage, isAiEffort } from "@flyee/ai/types";

/**
 * Running a task of the platform through a model, the one way every task goes.
 *
 * AI suggests and records. This function never decides anything: it asks the
 * store for the instructions in force, calls the provider, and hands back to
 * the store what came of it. The store (the database, in production) keeps the
 * run with the version it used, the hash of the input, the answer and the
 * cost, and puts the answer in the firm's approval queue when the task asks
 * for a person. What the answer MEANS is for that person, and for the rules,
 * which are code.
 *
 * The store is an interface on purpose: the executor is never handed a
 * database client, only the two things it may do to a run (start it, finish
 * it), each of which takes the firm.
 */

/** The instructions a run uses, as the store has them in force for the task. */
export interface RunPrompt {
  version: number;
  provider: AiProviderName;
  model: string;
  effort: string | null;
  systemPrompt: string;
  /** JSON Schema of the answer: an object at the root. */
  outputSchema: Record<string, unknown>;
  maxTokens: number;
}

export interface RunSubject {
  /** What the run is about (`document`, `message`): a short identifier. */
  type: string;
  id: string;
}

export interface StartRunInput {
  orgId: string;
  task: string;
  /** SHA-256 of the input, in hex. The input itself is not handed to the store. */
  inputHash: string;
  /** The person who asked, when a person did. */
  requestedBy?: string | null;
  subject?: RunSubject | null;
  /** The same key twice is one run: a retry or a job that ran again starts nothing new. */
  idempotencyKey?: string | null;
}

export type StartedRun =
  | { kind: "started"; runId: string; prompt: RunPrompt }
  | { kind: "existing"; runId: string; status: string }
  | { kind: "refused"; code: string };

export type RunStatus = "succeeded" | "failed" | "blocked";

export interface FinishRunInput {
  runId: string;
  status: RunStatus;
  output?: Record<string, unknown> | null;
  /** What the provider reported. Absent when the call never reached it. */
  usage?: ChatUsage | null;
  errorCode?: string | null;
}

export interface FinishedRun {
  /** The status the record has after the call: not the one asked for when the run was already closed. */
  status: RunStatus;
  /** Set when the answer waits for a person in the firm's queue. */
  approvalId: string | null;
  costUsdMicros: number;
  /** False when the model has no price: the cost is unknown, not zero. */
  priced: boolean;
}

export interface RunStore {
  start(input: StartRunInput): Promise<StartedRun>;
  finish(input: FinishRunInput): Promise<FinishedRun>;
}

export interface RunRequest {
  orgId: string;
  task: string;
  /** What the model is given. Hashed for the record; never stored by the executor. */
  input: unknown;
  /** The messages to send, when the default (the input as JSON) is not it: a task with attachments. */
  messages?: ChatMessage[];
  requestedBy?: string | null;
  subject?: RunSubject | null;
  idempotencyKey?: string | null;
}

export type RunResult =
  | {
      kind: "finished";
      runId: string;
      output: Record<string, unknown>;
      /** Set when the answer waits for a person; null when the task acts on its own. */
      approvalId: string | null;
      costUsdMicros: number;
      priced: boolean;
    }
  /** The same request was already made: nothing ran, the first run stands. */
  | { kind: "replayed"; runId: string; status: string }
  /** The store would not start it (an unknown task, no instructions in force, a requester of another firm). */
  | { kind: "refused"; code: string }
  /** It started and did not produce an answer. The run is recorded with this code. */
  | { kind: "failed"; runId: string; code: string };

export interface RunDeps {
  store: RunStore;
  /** The provider for a name, or null when this environment has no key for it. */
  provider: (name: AiProviderName) => ChatProvider | null;
}

/** JSON with the keys of every object in order, so the same input always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export const hashInput = (input: unknown): string => createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The keys the schema requires that the answer lacks. The provider enforces the schema; this is the second look. */
function missingRequired(schema: Record<string, unknown>, output: Record<string, unknown>): string[] {
  const required = Array.isArray(schema.required) ? schema.required : [];
  return required.filter((key): key is string => typeof key === "string" && !(key in output));
}

/** A tool or schema name a provider accepts, from the task's slug. */
const schemaName = (task: string): string => task.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

/** Why a call produced no answer, as a short code for the record. Never the provider's message: it may echo the input. */
function failureCode(error: unknown): { status: RunStatus; code: string } {
  if (isStructuredOutputError(error)) {
    return error.failure === "blocked"
      ? { status: "blocked", code: "provider_blocked" }
      : { status: "failed", code: `output_${error.failure}` };
  }
  return { status: "failed", code: providerFailureCode(error) };
}

/**
 * Runs one task for one firm and records it, whatever happens. Never throws
 * for what a model or a provider did: every outcome is a value, and a run
 * that started is always finished in the store.
 */
export async function runAiTask(deps: RunDeps, request: RunRequest): Promise<RunResult> {
  const started = await deps.store.start({
    orgId: request.orgId,
    task: request.task,
    inputHash: hashInput(request.input),
    requestedBy: request.requestedBy ?? null,
    subject: request.subject ?? null,
    idempotencyKey: request.idempotencyKey ?? null,
  });
  if (started.kind === "refused") return { kind: "refused", code: started.code };
  if (started.kind === "existing") return { kind: "replayed", runId: started.runId, status: started.status };

  const { runId, prompt } = started;
  const fail = async (status: RunStatus, code: string, usage: ChatUsage | null): Promise<RunResult> => {
    await deps.store.finish({ runId, status, usage, errorCode: code });
    return { kind: "failed", runId, code };
  };

  const provider = deps.provider(prompt.provider);
  if (!provider) return fail("failed", "provider_not_configured", null);

  const messages = request.messages ?? [{ role: "user" as const, content: canonicalJson(request.input) }];
  // A task about a document, on a provider that would not be sent the
  // document: the model would answer about something it never saw. The run
  // fails before the call instead.
  const carriesDocument = messages.some((message) =>
    (message.attachments ?? []).some((attachment) => attachment.kind === "document"),
  );
  if (carriesDocument && !provider.supportsDocuments(prompt.model)) {
    return fail("failed", "provider_cannot_read_documents", null);
  }
  // The same for sound: a transcription asked of a model that would never hear the audio.
  const carriesAudio = messages.some((message) =>
    (message.attachments ?? []).some((attachment) => attachment.kind === "audio"),
  );
  if (carriesAudio && !provider.supportsAudio(prompt.model)) {
    return fail("failed", "provider_cannot_read_audio", null);
  }

  let usage: ChatUsage | null = null;
  let answer: unknown;
  try {
    answer = await provider.generateStructured(
      {
        provider: prompt.provider,
        model: prompt.model,
        systemPrompt: prompt.systemPrompt,
        temperature: 0,
        maxTokens: prompt.maxTokens,
        // The effort the version names is the effort asked of the model: the
        // run records it, so it must be what was sent.
        ...(isAiEffort(prompt.effort) ? { effort: prompt.effort } : {}),
      },
      messages,
      { name: schemaName(request.task), schema: prompt.outputSchema },
      (reported) => {
        usage = reported;
      },
    );
  } catch (error) {
    const failure = failureCode(error);
    return fail(failure.status, failure.code, usage);
  }

  if (!isPlainObject(answer)) return fail("failed", "output_not_an_object", usage);
  if (missingRequired(prompt.outputSchema, answer).length > 0) return fail("failed", "output_incomplete", usage);

  const finished = await deps.store.finish({ runId, status: "succeeded", output: answer, usage });
  // The run was closed while the model was still answering (given up as
  // abandoned). Its answer takes no effect: without this, a caller would read
  // "no approval" as "the task acts on its own".
  if (finished.status !== "succeeded") return { kind: "failed", runId, code: "run_already_closed" };
  return {
    kind: "finished",
    runId,
    output: answer,
    approvalId: finished.approvalId,
    costUsdMicros: finished.costUsdMicros,
    priced: finished.priced,
  };
}
