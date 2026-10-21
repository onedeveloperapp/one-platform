import Anthropic from "@anthropic-ai/sdk";

import { StructuredOutputError } from "@flyee/ai/errors";
import {
  type AssistantConfig,
  type ChatMessage,
  type ChatProvider,
  type ChatUsage,
  type StructuredOutput,
  type UsageSink,
  reportUsage,
} from "@flyee/ai/types";

type ImageMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/**
 * Images and PDFs go as content blocks before the text; audio has no Anthropic
 * input and is skipped (send it through a transcription step first).
 */
function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => {
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image") {
        blocks.push({
          type: "image",
          source: { type: "base64", media_type: attachment.mime as ImageMime, data: attachment.dataBase64 },
        });
      } else if (attachment.kind === "document" && attachment.mime === "application/pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: attachment.dataBase64 },
        });
      }
    }
    blocks.push({ type: "text", text: message.content || "(no text)" });
    return { role: message.role, content: blocks };
  });
}

/** What the call consumed, cache reads and writes included, as the API reported it. */
function usageOf(usage: Anthropic.Usage | undefined, model: string): ChatUsage {
  return {
    tokensIn: usage?.input_tokens ?? 0,
    tokensOut: usage?.output_tokens ?? 0,
    cacheReadTokensIn: usage?.cache_read_input_tokens ?? 0,
    cacheWriteTokensIn: usage?.cache_creation_input_tokens ?? 0,
    model,
  };
}

/**
 * An answer that may be longer than this (a draft of a piece, pages of it) is
 * read as it is written and given the time of one step of a job, with no
 * second attempt: a request that waits whole for a long answer is cut by the
 * time one request may take, and trying it twice would pass what the step has.
 */
export const LONG_ANSWER_TOKENS = 4096;
export const LONG_ANSWER_MS = 240_000;

/**
 * The client for one call. Without these limits the SDK defaults to 600 s per
 * attempt with retries: half an hour of a serverless invocation capped at
 * 120 to 300 s.
 */
function clientFor(long = false): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  return new Anthropic({ apiKey: key, timeout: long ? LONG_ANSWER_MS : 90_000, maxRetries: long ? 0 : 1 });
}

/**
 * Claude through the Messages API, written for the current models: no sampling
 * parameter is sent (Opus 5.5 refuses any; Sonnet 5.5 and Haiku 5.5 accept only
 * the default) and structured output uses `output_config.format`, not a forced
 * tool choice (refused by Opus 5.5 and Sonnet 5.5). How hard the model thinks
 * is `output_config.effort`, sent only when the caller names one: thinking
 * itself is never configured here (Opus 5.5 refuses to have it turned off).
 * A structured answer that may be long is asked for as a stream and read
 * whole at its end (`finalMessage`), stopped by this code when it passes the
 * time it has: the SDK's own limit covers the wait for an answer to start,
 * not the time it takes to arrive.
 */
export class AnthropicProvider implements ChatProvider {
  readonly name = "anthropic" as const;
  /** How long a long answer may take to arrive whole. Only a test gives another. */
  private readonly longAnswerMs: number;

  constructor(options: { longAnswerMs?: number } = {}) {
    this.longAnswerMs = options.longAnswerMs ?? LONG_ANSWER_MS;
  }

  supportsAudio(): boolean {
    // The Anthropic API has no audio input; transcribe first.
    return false;
  }

  supportsDocuments(): boolean {
    // A PDF goes as a document block: the model reads its text and its pages.
    return true;
  }

  async *streamChat(config: AssistantConfig, messages: ChatMessage[], onUsage?: UsageSink): AsyncGenerator<string> {
    const client = clientFor();
    const stream = client.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: toAnthropicMessages(messages),
      ...(config.effort ? { output_config: { effort: config.effort } } : {}),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }

    // Usage only settles on the assembled message.
    const final = await stream.finalMessage();
    reportUsage(onUsage, usageOf(final.usage, final.model ?? config.model));
    if (final.stop_reason === "refusal") {
      throw new StructuredOutputError({ failure: "blocked", provider: "anthropic", finishReason: "refusal" });
    }
  }

  async generateStructured(
    config: AssistantConfig,
    messages: ChatMessage[],
    output: StructuredOutput,
    onUsage?: UsageSink,
  ): Promise<unknown> {
    const long = config.maxTokens > LONG_ANSWER_TOKENS;
    const client = clientFor(long);
    const request: Anthropic.MessageCreateParamsNonStreaming = {
      model: config.model,
      max_tokens: config.maxTokens,
      system: config.systemPrompt,
      messages: toAnthropicMessages(messages),
      output_config: {
        ...(config.effort ? { effort: config.effort } : {}),
        format: { type: "json_schema", schema: output.schema },
      },
    };
    let response: Anthropic.Message;
    if (long) {
      const stream = client.messages.stream(request);
      const stop = setTimeout(() => stream.abort(), this.longAnswerMs);
      try {
        response = await stream.finalMessage();
      } catch (error) {
        // An answer cut on the way was charged for as far as it went, so a run that failed for time is never
        // a run that cost nothing. The stream counts what was written only when the answer ends: until then
        // it is estimated from what arrived of it, a token for every three characters (more than a token
        // usually is: a ledger that errs, errs high), and never below what the stream had counted.
        const message = stream.currentMessage;
        if (message?.usage) {
          const written = message.content.reduce(
            (sum, block) =>
              sum + (block.type === "text" ? block.text.length : block.type === "thinking" ? block.thinking.length : 0),
            0,
          );
          const usage = { ...message.usage, output_tokens: Math.max(message.usage.output_tokens ?? 0, Math.ceil(written / 3)) };
          reportUsage(onUsage, usageOf(usage, message.model ?? config.model));
        }
        throw error;
      } finally {
        clearTimeout(stop);
      }
    } else {
      response = await client.messages.create(request);
    }

    // Reported before the failure checks: a call cut at max_tokens or refused
    // was still billed, and a ledger that counts only successes understates it.
    reportUsage(onUsage, usageOf(response.usage, response.model ?? config.model));

    const stopReason = (response.stop_reason ?? undefined) as string | undefined;
    if (stopReason === "max_tokens") {
      throw new StructuredOutputError({ failure: "truncated", provider: "anthropic", finishReason: stopReason });
    }
    if (stopReason === "refusal") {
      throw new StructuredOutputError({ failure: "blocked", provider: "anthropic", finishReason: stopReason });
    }

    // The schema-constrained reply arrives as the text of the message.
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) {
      throw new StructuredOutputError({ failure: "empty", provider: "anthropic", finishReason: stopReason });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new StructuredOutputError({ failure: "empty", provider: "anthropic", finishReason: stopReason });
    }
  }
}
