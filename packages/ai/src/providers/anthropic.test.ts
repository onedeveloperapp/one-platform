import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { AnthropicProvider } from "./anthropic.ts";
import { providerFailureCode, StructuredOutputError } from "../errors.ts";
import type { AssistantConfig, ChatUsage } from "../types.ts";

const config: AssistantConfig = {
  provider: "anthropic",
  model: "claude-haiku-5-5",
  systemPrompt: "You are a test.",
  temperature: 0.4,
  maxTokens: 1024,
};

const OUTPUT = {
  name: "check",
  schema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  },
};

type Reply = { text?: string; stopReason?: string };

/** Runs the call against a fake Messages API and returns the request body it sent. */
async function capture(reply: Reply, run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  const original = globalThis.fetch;
  let body: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? "{}"));
    // Asked for as a stream: the same answer, in the events the Messages API sends one.
    if (body.stream === true) {
      const events: [string, Record<string, unknown>][] = [
        [
          "message_start",
          {
            message: {
              id: "msg_test",
              type: "message",
              role: "assistant",
              model: String(body.model),
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
            },
          },
        ],
        ...(reply.text === undefined
          ? []
          : ([
              ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
              // In two pieces, as an answer arrives.
              ["content_block_delta", { index: 0, delta: { type: "text_delta", text: reply.text.slice(0, 3) } }],
              ["content_block_delta", { index: 0, delta: { type: "text_delta", text: reply.text.slice(3) } }],
              ["content_block_stop", { index: 0 }],
            ] as [string, Record<string, unknown>][])),
        [
          "message_delta",
          { delta: { stop_reason: reply.stopReason ?? "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
        ],
        ["message_stop", {}],
      ];
      const text = events
        .map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
        .join("");
      return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-haiku-5-5",
      content: reply.text === undefined ? [] : [{ type: "text", text: reply.text }],
      stop_reason: reply.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 },
    };
    return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return body;
}

describe("Anthropic provider", () => {
  const provider = new AnthropicProvider();
  let previousKey: string | undefined;

  before(() => {
    previousKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  after(() => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  });

  it("asks for structured output through output_config, with no sampling parameter and no forced tool", async () => {
    let result: unknown;
    const body = await capture({ text: '{"ok":true}' }, async () => {
      result = await provider.generateStructured(config, [{ role: "user", content: "check" }], OUTPUT);
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(body.temperature, undefined);
    assert.equal(body.tool_choice, undefined);
    assert.equal(body.tools, undefined);
    assert.deepEqual(body.output_config, { format: { type: "json_schema", schema: OUTPUT.schema } });
  });

  it("sends the effort the caller names beside the format, and none when it names none", async () => {
    const body = await capture({ text: '{"ok":true}' }, async () => {
      await provider.generateStructured({ ...config, effort: "low" }, [{ role: "user", content: "check" }], OUTPUT);
    });
    assert.deepEqual(body.output_config, { effort: "low", format: { type: "json_schema", schema: OUTPUT.schema } });
    // Thinking is the model's own business: never turned off, never given a budget.
    assert.equal(body.thinking, undefined);
  });

  it("reports cache reads and writes with the usage", async () => {
    const seen: ChatUsage[] = [];
    await capture({ text: '{"ok":true}' }, async () => {
      await provider.generateStructured(config, [{ role: "user", content: "check" }], OUTPUT, (usage) =>
        seen.push(usage),
      );
    });
    assert.deepEqual(seen, [
      { tokensIn: 10, tokensOut: 5, cacheReadTokensIn: 3, cacheWriteTokensIn: 2, model: "claude-haiku-5-5" },
    ]);
  });

  it("sends a PDF attachment as a document block before the text", async () => {
    const body = await capture({ text: '{"ok":true}' }, async () => {
      await provider.generateStructured(
        config,
        [
          {
            role: "user",
            content: "read it",
            attachments: [{ kind: "document", mime: "application/pdf", dataBase64: "JVBERi0=" }],
          },
        ],
        OUTPUT,
      );
    });
    const messages = body.messages as { content: { type: string; source?: { media_type?: string } }[] }[];
    assert.equal(messages[0].content[0].type, "document");
    assert.equal(messages[0].content[0].source?.media_type, "application/pdf");
    assert.equal(messages[0].content[1].type, "text");
  });

  it("reads a long answer as it is written, and gives the same answer, usage and failures", async () => {
    const long = { ...config, model: "claude-opus-5-5", maxTokens: 16_000, effort: "high" as const };
    const seen: ChatUsage[] = [];
    let result: unknown;
    const body = await capture({ text: '{"ok":true}' }, async () => {
      result = await provider.generateStructured(long, [{ role: "user", content: "write" }], OUTPUT, (usage) =>
        seen.push(usage),
      );
    });
    assert.deepEqual(result, { ok: true });
    // Asked for as a stream, with the same request otherwise.
    assert.equal(body.stream, true);
    assert.equal(body.max_tokens, 16_000);
    assert.deepEqual(body.output_config, { effort: "high", format: { type: "json_schema", schema: OUTPUT.schema } });
    assert.equal(body.temperature, undefined);
    assert.deepEqual(seen, [
      { tokensIn: 10, tokensOut: 5, cacheReadTokensIn: 3, cacheWriteTokensIn: 2, model: "claude-opus-5-5" },
    ]);
    // A short answer is still asked for whole.
    const short = await capture({ text: '{"ok":true}' }, async () => {
      await provider.generateStructured({ ...config, maxTokens: 4096 }, [{ role: "user", content: "check" }], OUTPUT);
    });
    assert.equal(short.stream, undefined);
    // What a stream ends with is read the same way.
    await capture({ text: '{"ok":', stopReason: "max_tokens" }, async () => {
      await assert.rejects(
        provider.generateStructured(long, [{ role: "user", content: "write" }], OUTPUT),
        (error: unknown) => error instanceof StructuredOutputError && error.failure === "truncated",
      );
    });
    await capture({ stopReason: "refusal" }, async () => {
      await assert.rejects(
        provider.generateStructured(long, [{ role: "user", content: "write" }], OUTPUT),
        (error: unknown) => error instanceof StructuredOutputError && error.failure === "blocked",
      );
    });
  });

  it("stops a long answer that does not arrive in its time, and records what it was charged till then", async () => {
    const original = globalThis.fetch;
    // The answer starts (the model was handed the request and counted it) and never ends.
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const start = {
        type: "message_start",
        message: {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 4000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      };
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`event: message_start\ndata: ${JSON.stringify(start)}\n\n`));
          // Thirty characters of the answer arrive, and nothing after them.
          const opened = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
          const written = { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "x".repeat(30) } };
          controller.enqueue(encoder.encode(`event: content_block_start\ndata: ${JSON.stringify(opened)}\n\n`));
          controller.enqueue(encoder.encode(`event: content_block_delta\ndata: ${JSON.stringify(written)}\n\n`));
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof globalThis.fetch;
    const seen: ChatUsage[] = [];
    let failure: unknown;
    try {
      await new AnthropicProvider({ longAnswerMs: 60 }).generateStructured(
        { ...config, model: "claude-opus-5-5", maxTokens: 16_000 },
        [{ role: "user", content: "write" }],
        OUTPUT,
        (usage) => seen.push(usage),
      );
    } catch (error) {
      failure = error;
    } finally {
      globalThis.fetch = original;
    }
    assert.ok(failure, "a stream that never ends is stopped");
    // A failure that may pass: the worker that asked tries again.
    assert.equal(providerFailureCode(failure), "provider_unavailable");
    assert.deepEqual(seen, [
      // What was written is estimated from what arrived (the stream counts it only at the end): 30 / 3.
      { tokensIn: 4000, tokensOut: 10, cacheReadTokensIn: 0, cacheWriteTokensIn: 0, model: "claude-opus-5-5" },
    ]);
  });

  it("turns a refusal into a blocked error and a cut reply into a truncated one", async () => {
    await capture({ text: "", stopReason: "refusal" }, async () => {
      await assert.rejects(
        provider.generateStructured(config, [{ role: "user", content: "check" }], OUTPUT),
        (error: unknown) => error instanceof StructuredOutputError && error.failure === "blocked",
      );
    });
    await capture({ text: '{"ok":', stopReason: "max_tokens" }, async () => {
      await assert.rejects(
        provider.generateStructured(config, [{ role: "user", content: "check" }], OUTPUT),
        (error: unknown) => error instanceof StructuredOutputError && error.failure === "truncated",
      );
    });
  });
});
