import assert from "node:assert/strict";
import test from "node:test";

import { StructuredOutputError } from "./errors.ts";
import { FAKE_MODEL, FakeChatProvider, FakeRunStore, type FakeTask } from "./fake.ts";
import { canonicalJson, hashInput, runAiTask } from "./runs.ts";

const TASK = "plataforma.verificacao";

const task = (overrides: Partial<FakeTask> = {}): FakeTask => ({
  needsApproval: true,
  prompt: {
    version: 3,
    provider: "anthropic",
    model: "modelo-de-teste",
    effort: "low",
    systemPrompt: "Confirme a tarefa pedida em uma frase curta.",
    outputSchema: {
      type: "object",
      required: ["resposta"],
      properties: { resposta: { type: "string", description: "uma frase" } },
    },
    maxTokens: 256,
  },
  ...overrides,
});

function setup(overrides: Partial<FakeTask> = {}, provider = new FakeChatProvider()) {
  const store = new FakeRunStore({ [TASK]: task(overrides) }, { [FAKE_MODEL]: [3, 15] });
  return { store, provider, deps: { store, provider: () => provider } };
}

test("a run asks the model with the instructions in force and records the answer for a person to decide", async () => {
  const { store, provider, deps } = setup();
  const result = await runAiTask(deps, {
    orgId: "firm-a",
    task: TASK,
    input: { pergunta: "verificar o executor" },
    requestedBy: "ana",
  });

  assert.equal(result.kind, "finished");
  if (result.kind !== "finished") return;
  assert.deepEqual(Object.keys(result.output), ["resposta"]);
  assert.equal(result.approvalId, "approval-run-1");
  assert.equal(result.priced, true);
  assert.ok(result.costUsdMicros > 0);

  // The provider received the version's own instructions, model, effort and schema.
  const call = provider.calls[0];
  assert.equal(call.config.model, "modelo-de-teste");
  assert.equal(call.config.systemPrompt, "Confirme a tarefa pedida em uma frase curta.");
  assert.equal(call.config.maxTokens, 256);
  assert.equal(call.config.effort, "low");
  assert.equal(call.output.name, "plataforma_verificacao");
  assert.equal(call.messages[0].content, '{"pergunta":"verificar o executor"}');

  // The store has the firm, the requester, the hash of the input and the answer: never the input.
  const run = store.runs[0];
  assert.equal(run.orgId, "firm-a");
  assert.equal(run.requestedBy, "ana");
  assert.equal(run.inputHash, hashInput({ pergunta: "verificar o executor" }));
  assert.equal(run.status, "succeeded");
  assert.ok(!JSON.stringify(run).includes("verificar o executor"));
});

test("a version that names no effort, or one this code does not know, sends none", async () => {
  for (const effort of [null, "enorme"]) {
    const { provider, deps } = setup({ prompt: { ...task().prompt, effort } });
    await runAiTask(deps, { orgId: "firm-a", task: TASK, input: {} });
    assert.equal("effort" in provider.calls[0].config, false);
  }
});

test("a run made with the fake provider is recorded under the fake's name, never the model it stood in for", async () => {
  const { store, deps } = setup();
  await runAiTask(deps, { orgId: "firm-a", task: TASK, input: {} });
  assert.equal(store.runs[0].usage?.model, FAKE_MODEL);
});

test("the same input hashes the same whatever order its keys came in", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
  assert.equal(hashInput({ a: 1, b: 2 }), hashInput({ b: 2, a: 1 }));
  assert.notEqual(hashInput({ a: 1 }), hashInput({ a: 2 }));
  assert.match(hashInput("texto"), /^[0-9a-f]{64}$/);
});

test("a task that earned autonomy leaves nothing in the queue", async () => {
  const { deps } = setup({ needsApproval: false });
  const result = await runAiTask(deps, { orgId: "firm-a", task: TASK, input: {} });
  assert.equal(result.kind, "finished");
  assert.equal(result.kind === "finished" && result.approvalId, null);
});

test("the same request made twice is one run, and the model is asked once", async () => {
  const { store, provider, deps } = setup();
  const request = { orgId: "firm-a", task: TASK, input: { n: 1 }, idempotencyKey: "pedido-0001" };
  const first = await runAiTask(deps, request);
  const second = await runAiTask(deps, request);
  assert.equal(first.kind, "finished");
  assert.deepEqual(second, { kind: "replayed", runId: "run-1", status: "succeeded" });
  assert.equal(provider.calls.length, 1);
  assert.equal(store.runs.length, 1);

  // The key belongs to the firm: another firm with the same key gets its own run.
  const other = await runAiTask(deps, { ...request, orgId: "firm-b" });
  assert.equal(other.kind, "finished");
  assert.equal(store.runs.length, 2);
});

test("a task the store does not know is refused before any model is asked", async () => {
  const { provider, deps } = setup();
  const result = await runAiTask(deps, { orgId: "firm-a", task: "tarefa.desconhecida", input: {} });
  assert.deepEqual(result, { kind: "refused", code: "unknown_task" });
  assert.equal(provider.calls.length, 0);
});

test("with no key for the provider the run is recorded as failed, never left running", async () => {
  const { store } = setup();
  const result = await runAiTask({ store, provider: () => null }, { orgId: "firm-a", task: TASK, input: {} });
  assert.deepEqual(result, { kind: "failed", runId: "run-1", code: "provider_not_configured" });
  assert.equal(store.runs[0].status, "failed");
  assert.equal(store.runs[0].errorCode, "provider_not_configured");
  assert.equal(store.runs[0].approvalId, null);
});

test("a provider that is down, one that rejects and one that refuses are told apart", async () => {
  const down = setup();
  down.provider.failNextWith(Object.assign(new Error("overloaded"), { status: 503 }));
  assert.deepEqual(await runAiTask(down.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "provider_unavailable",
  });

  const rejected = setup();
  rejected.provider.failNextWith(Object.assign(new Error("model not found"), { status: 404 }));
  assert.deepEqual(await runAiTask(rejected.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "provider_rejected",
  });

  // The platform's key refused: nothing of the firm's work is at fault (0255 marks the provider down).
  const account = setup();
  account.provider.failNextWith(Object.assign(new Error("invalid api key"), { status: 401 }));
  assert.deepEqual(await runAiTask(account.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "provider_account",
  });
  assert.equal(account.store.runs[0].errorCode, "provider_account");

  const refused = setup();
  refused.provider.failNextWith(new StructuredOutputError({ failure: "blocked", provider: "anthropic" }));
  assert.deepEqual(await runAiTask(refused.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "provider_blocked",
  });
  assert.equal(refused.store.runs[0].status, "blocked");

  const cut = setup();
  cut.provider.failNextWith(new StructuredOutputError({ failure: "truncated", provider: "anthropic" }));
  assert.deepEqual(await runAiTask(cut.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "output_truncated",
  });
});

test("the record of a failure carries a code, never the provider's message", async () => {
  const { store, provider, deps } = setup();
  provider.failNextWith(Object.assign(new Error("the document of Fulano de Tal could not be read"), { status: 400 }));
  await runAiTask(deps, { orgId: "firm-a", task: TASK, input: {} });
  assert.equal(store.runs[0].errorCode, "provider_rejected");
  assert.ok(!JSON.stringify(store.runs[0]).includes("Fulano"));
});

test("an answer that is not the object the schema asks for is a failed run, with its cost", async () => {
  const text = setup({}, new FakeChatProvider("anthropic", () => "apenas um texto"));
  assert.deepEqual(await runAiTask(text.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "output_not_an_object",
  });
  // The provider answered and charged for it: the usage is kept with the failure.
  assert.ok((text.store.runs[0].usage?.tokensOut ?? 0) > 0);

  const incomplete = setup({}, new FakeChatProvider("anthropic", () => ({ outra: "chave" })));
  assert.deepEqual(await runAiTask(incomplete.deps, { orgId: "firm-a", task: TASK, input: {} }), {
    kind: "failed",
    runId: "run-1",
    code: "output_incomplete",
  });
  assert.equal(incomplete.store.runs[0].approvalId, null);
});

test("an answer that lands after the run was given up takes no effect", async () => {
  // The sweep closes the run while the model is still answering.
  const store = new FakeRunStore({ [TASK]: task({ needsApproval: false }) }, { [FAKE_MODEL]: [3, 15] });
  const provider = new FakeChatProvider("anthropic", () => {
    store.abandon("run-1");
    return { resposta: "Chegou tarde." };
  });
  const result = await runAiTask({ store, provider: () => provider }, { orgId: "firm-a", task: TASK, input: {} });

  // Never `finished` with no approval: that would read as "the task acts on its own".
  assert.deepEqual(result, { kind: "failed", runId: "run-1", code: "run_already_closed" });
  assert.equal(store.runs[0].status, "failed");
  assert.equal(store.runs[0].errorCode, "abandoned");
  assert.equal(store.runs[0].output, null);
  // What the late call consumed is still on the record.
  assert.ok((store.runs[0].usage?.tokensOut ?? 0) > 0);
});

test("a model with no price is reported as unpriced, never as free", async () => {
  const store = new FakeRunStore({ [TASK]: task() });
  const provider = new FakeChatProvider();
  const result = await runAiTask({ store, provider: () => provider }, { orgId: "firm-a", task: TASK, input: {} });
  assert.equal(result.kind, "finished");
  assert.equal(result.kind === "finished" && result.priced, false);
  assert.equal(result.kind === "finished" && result.costUsdMicros, 0);
});

test("a document is never handed to a provider that would not send it to the model", async () => {
  const { store, provider, deps } = setup();
  provider.readsDocuments = false;
  const result = await runAiTask(deps, {
    orgId: "firm-a",
    task: TASK,
    input: { documento: "doc-1" },
    messages: [
      {
        role: "user",
        content: "Leia o anexo.",
        attachments: [{ kind: "document", mime: "application/pdf", dataBase64: "JVBERi0=" }],
      },
    ],
  });
  // Failed before the call: the model never answers about a document it did not see.
  assert.deepEqual(result, { kind: "failed", runId: "run-1", code: "provider_cannot_read_documents" });
  assert.equal(provider.calls.length, 0);
  assert.equal(store.runs[0].status, "failed");

  // The same request on a provider that reads documents goes through.
  const reads = setup();
  const sent = await runAiTask(reads.deps, {
    orgId: "firm-a",
    task: TASK,
    input: { documento: "doc-1" },
    messages: [
      {
        role: "user",
        content: "Leia o anexo.",
        attachments: [{ kind: "document", mime: "application/pdf", dataBase64: "JVBERi0=" }],
      },
    ],
  });
  assert.equal(sent.kind, "finished");
  assert.equal(reads.provider.calls[0].messages[0].attachments?.[0].kind, "document");
});

test("an audio is never handed to a provider that would not send it to the model", async () => {
  const request = {
    orgId: "firm-a",
    task: TASK,
    input: { sha256: "a".repeat(64) },
    messages: [
      {
        role: "user" as const,
        content: "Transcreva o áudio anexo.",
        attachments: [{ kind: "audio" as const, mime: "audio/ogg", dataBase64: "T2dnUw==" }],
      },
    ],
  };
  const deaf = setup();
  deaf.provider.readsAudio = false;
  const result = await runAiTask(deaf.deps, request);
  // Failed before the call: no transcription of an audio the model never heard.
  assert.deepEqual(result, { kind: "failed", runId: "run-1", code: "provider_cannot_read_audio" });
  assert.equal(deaf.provider.calls.length, 0);
  assert.equal(deaf.store.runs[0].status, "failed");

  const hears = setup();
  const sent = await runAiTask(hears.deps, request);
  assert.equal(sent.kind, "finished");
  assert.equal(hears.provider.calls[0].messages[0].attachments?.[0].kind, "audio");
});

test("a task with attachments sends the messages it was given, and still hashes the input", async () => {
  const { store, provider, deps } = setup();
  await runAiTask(deps, {
    orgId: "firm-a",
    task: TASK,
    input: { documento: "doc-1" },
    messages: [{ role: "user", content: "Leia o anexo.", attachments: [] }],
    subject: { type: "document", id: "doc-1" },
  });
  assert.equal(provider.calls[0].messages[0].content, "Leia o anexo.");
  assert.equal(store.runs[0].inputHash, hashInput({ documento: "doc-1" }));
  assert.deepEqual(store.runs[0].subject, { type: "document", id: "doc-1" });
});
