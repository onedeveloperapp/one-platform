# @flyee/ai

The AI layer of ONE: model providers behind one interface, and the executor that runs a task of the platform and records it.

Two rules shape everything here (`CLAUDE.md`, engineering rules 1 and 2):

- **AI never decides a rule.** Forum, deadlines, prescription and eligibility are code in `packages/rules`. A model reads, classifies and drafts.
- **AI suggests and records.** Every run is stored with the task, the prompt version, the model, the effort, a hash of the input, the output and the cost. An answer takes effect only after a lawyer of the firm approves it, until the task earns autonomy by measured accuracy.

## What is in the package

| File | What it holds |
| --- | --- |
| `src/types.ts` | `ChatProvider`, `AssistantConfig` (model, instructions, token cap, effort), `StructuredOutput`, `ChatUsage` |
| `src/providers/*` | Anthropic, Gemini, OpenAI and OpenRouter behind `ChatProvider` |
| `src/runs.ts` | `runAiTask`: the one way a task goes through a model, over a `RunStore` |
| `src/fake.ts` | `FakeChatProvider` and `FakeRunStore`: the same contracts with no network, no key and no database |
| `src/errors.ts` | Why a call produced no usable answer (`truncated`, `blocked`, `empty`, `invalid_json`) and whether trying again could work |
| `src/strict-schema.ts` | Turns a JSON Schema into the strict form some providers require |

## Running a task

A task is a row of `ai_tasks`, and what it asks of the model is the prompt version in force for it (`prompt_versions`, immutable once published). Both are data (migration `0016_ai_runs`); nothing about a task is a constant in code.

```ts
import { runAiTask } from "@flyee/ai/runs";

const result = await runAiTask(
  { store, provider: (name) => providerOrNull(name) },
  { orgId, task: "plataforma.verificacao", input, requestedBy, idempotencyKey },
);
```

`runAiTask` asks the store to start the run (which hands back the instructions in force), calls the provider the version names, and hands the store what came of it. It never throws for what a model or a provider did. The result is one of:

- `finished`: the answer, the cost, and `approvalId` when the answer waits for a person. `approvalId: null` means the task acts on its own.
- `replayed`: the same idempotency key was already used. Nothing ran; the first run stands. A new attempt takes a new key.
- `refused`: the store would not start it (an unknown task, no instructions in force, a requester of another firm).
- `failed`: it started and produced no answer. The run is recorded with a short code (`provider_not_configured`, `provider_cannot_read_documents`, `provider_unavailable`, `provider_rejected`, `provider_blocked`, `output_truncated`, `output_incomplete`, `run_already_closed`), never with the provider's message, which may echo the input.

The store is an interface on purpose. The executor is never handed a database client, only the two things it may do to a run, each of which takes the firm. In the app the store is `apps/web/src/lib/ai/run-store.ts` over the service role, and the entry point is `runFirmTask` in `apps/web/src/lib/ai/executor.ts`.

The input of a run is hashed for the record and never stored: it is the firm's own data, which already lives where it belongs.

## Providers

| | Anthropic | Gemini | OpenAI | OpenRouter |
| --- | --- | --- | --- | --- |
| Model field | `claude-opus-5-5` | `gemini-2.5-flash` | native id, `gpt-4o` | full id, `openai/gpt-4o` |
| Images | base64 blocks | inlineData | data URLs | data URLs (most models) |
| PDF | document block | inlineData | never sent | never sent |
| Audio | no input | native | audio models only | depends on the model |
| Structured output | `output_config.format` | `responseJsonSchema` | `response_format` | `response_format` (support varies) |
| Effort | `output_config.effort` | not sent | not sent | not sent |

The Anthropic provider is written for the current models: it sends no sampling parameter (Opus 5.5 refuses any), no forced tool choice, and never configures thinking. How hard the model thinks is `effort` (`low` to `max`), sent only when the prompt version names one. On these models the thinking is spent from the same `max_tokens` as the answer, so a version with a small cap can be cut before the answer is complete (`output_truncated`).

A long answer is streamed. A prompt version whose `max_tokens` is above 4,096 (`LONG_ANSWER_TOKENS`: the draft of a piece asks for 16,000) is sent with `messages.stream` and read with `finalMessage()`, because a request that waits in silence for a long answer is cut by the network on the way; the caller still receives one whole answer. The SDK's own timeout covers only the wait for the first bytes, so the provider stops the stream itself after `LONG_ANSWER_MS` (240 seconds, inside the 300 a function has), which is a failure that may be tried again. A long answer is not retried inside the call: the worker that asked decides. Short answers go as before, in one request.

A provider with no key in the environment is a recorded failure (`provider_not_configured`), never a silent switch to another provider: a prompt is written and measured for one model.

A task that carries a PDF runs only on a provider whose `supportsDocuments()` is true. On any other the run fails before the call (`provider_cannot_read_documents`): a model is never asked about a document it was not sent.

## What a call cost

Every provider reports usage through the `onUsage` sink, before its failure checks: a call cut at the token cap or refused was still billed. `finish_ai_run` prices it in the database (`ai_prices`, per million tokens) and writes the cost ledger of the firm. A model with no price is recorded as unpriced, never as free.

## The fake

`FakeChatProvider` answers from the schema, deterministically. `FakeRunStore` keeps runs in memory with the rules of the real store the executor depends on. The app uses the fake provider only when `AI_FAKE_PROVIDER=1`, and never in production. Its runs are recorded under the model name `fake`, so nobody reads one later as an answer of the model it stood in for, and no price list charges it as one.

## Environment

```
ANTHROPIC_API_KEY=   GEMINI_API_KEY=   OPENAI_API_KEY=   OPENROUTER_API_KEY=
OPENAI_BASE_URL=     # optional: a proxy speaking the OpenAI API
AI_FAKE_PROVIDER=    # "1": the fake answers every task; ignored in production
```

## Tests

`npm run test:ai` runs the provider tests against a fake HTTP layer and the executor tests against the fake store. No key and no network.
