import type { AiProviderName } from "./types";

/**
 * Why a schema-constrained generation produced no usable JSON.
 *
 * The distinction is not academic: a `truncated` answer means the model ran out
 * of output budget (retrying often works, and the CAP is the real fix), while
 * `blocked` means the provider refused (retrying the same prompt will not).
 * Collapsing both into "the AI failed" makes a reproducible bug look random
 * to whoever reads the record of the run.
 */
export type StructuredOutputFailure = "truncated" | "blocked" | "empty" | "invalid_json";

export interface StructuredOutputErrorInput {
  failure: StructuredOutputFailure;
  provider: AiProviderName;
  /** The provider's own reason string (Gemini finishReason, Anthropic stop_reason…). */
  finishReason?: string;
  /**
   * Extra context for the SERVER LOG only. Never put model output here: these
   * messages are logged, and the model was reading a client's document.
   */
  detail?: string;
}

export class StructuredOutputError extends Error {
  readonly failure: StructuredOutputFailure;
  readonly provider: AiProviderName;
  readonly finishReason?: string;

  constructor({ failure, provider, finishReason, detail }: StructuredOutputErrorInput) {
    super(
      `${provider} structured output ${failure}` +
        (finishReason ? ` (finishReason ${finishReason})` : "") +
        (detail ? `: ${detail}` : ""),
    );
    this.name = "StructuredOutputError";
    this.failure = failure;
    this.provider = provider;
    this.finishReason = finishReason;
  }
}

export function isStructuredOutputError(error: unknown): error is StructuredOutputError {
  // `instanceof` alone breaks across duplicated module instances (a bundler can
  // ship two copies of this file), so the name is checked too.
  return (
    error instanceof StructuredOutputError ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "StructuredOutputError")
  );
}

/** Gemini finish reasons that mean "the provider refused", not "it ran out of room". */
const GEMINI_BLOCKED_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

export interface GeminiStructuredResponse {
  text?: string | null;
  candidates?: { finishReason?: string | null }[] | null;
  promptFeedback?: { blockReason?: string | null } | null;
}

/**
 * Read WHY the generation stopped, before trying to parse it.
 *
 * Returns null when the response looks usable. This is a pure function so the
 * decision is testable without a network call.
 */
export function structuredFailureFromGemini(
  response: GeminiStructuredResponse,
): { failure: StructuredOutputFailure; finishReason?: string } | null {
  const blockReason = response.promptFeedback?.blockReason ?? undefined;
  if (blockReason) return { failure: "blocked", finishReason: blockReason };

  const finishReason = response.candidates?.[0]?.finishReason ?? undefined;
  if (finishReason === "MAX_TOKENS") return { failure: "truncated", finishReason };
  if (finishReason && GEMINI_BLOCKED_FINISH.has(finishReason)) return { failure: "blocked", finishReason };
  if (!response.text || !response.text.trim()) return { failure: "empty", finishReason };
  return null;
}

/** Markers of a 429 that is a BILLING state, not a rate limit — retrying is noise. */
const FATAL_QUOTA_MARKERS = ["prepayment", "credits are depleted", "billing"];

/**
 * Words a provider uses when it refuses the platform's ACCOUNT, whatever was asked: a key it does not know, no
 * credit left. Read beside a 400, 402 or 429 (Anthropic answers an empty balance with a 400, Gemini a bad key with
 * a 400); a 401 or a 403 is the account by its status alone.
 */
const ACCOUNT_MARKERS = [
  "credit balance",
  "credits are depleted",
  "prepayment",
  "billing",
  "api key not valid",
  "api_key_invalid",
  "invalid api key",
  "invalid x-api-key",
  "incorrect api key",
];

const STATUS_PATTERNS = [/"code"\s*:\s*(\d{3})/, /\((\d{3})\)/, /\bstatus\s*(?:code)?\s*[:=]?\s*(\d{3})\b/i];

export interface AiFailure {
  status: number | null;
  /** True when trying again later could plausibly succeed. */
  transient: boolean;
  /**
   * True when the provider refused the platform's account (its key, its credit), not the request: nothing of the
   * work that asked is at fault, and every other request fails the same way until the platform puts it right.
   */
  account: boolean;
}

/**
 * Decide from the HTTP status whether trying again could work — the same rule
 * `packages/transcribe/src/transcribe.ts` uses for the transcription chain, so
 * a capacity 503 and a dead API key stop looking identical to the caller.
 */
export function classifyAiError(error: unknown): AiFailure {
  if (isStructuredOutputError(error)) {
    // A refusal repeats; an exhausted budget or a mangled answer usually does not.
    return { status: null, transient: error.failure !== "blocked", account: false };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusProperty = (error as { status?: unknown } | null)?.status;
  let status = typeof statusProperty === "number" && Number.isInteger(statusProperty) ? statusProperty : null;
  if (status === null) {
    for (const pattern of STATUS_PATTERNS) {
      const parsed = Number(pattern.exec(message)?.[1]);
      if (Number.isInteger(parsed)) {
        status = parsed;
        break;
      }
    }
  }

  const lower = message.toLowerCase();
  if (status === 401 || status === 403) return { status, transient: false, account: true };
  if (status !== null && [400, 402, 429].includes(status) && ACCOUNT_MARKERS.some((marker) => lower.includes(marker))) {
    return { status, transient: false, account: true };
  }
  if (status === 429) {
    return { status, transient: !FATAL_QUOTA_MARKERS.some((marker) => lower.includes(marker)), account: false };
  }
  if (status !== null && [408, 500, 502, 503, 504].includes(status)) return { status, transient: true, account: false };
  // A retired model, a rejected request: retrying changes nothing.
  if (status !== null && status >= 400 && status < 500) return { status, transient: false, account: false };
  // No recognizable status: aborted/timeout/network — worth another try.
  return { status, transient: true, account: false };
}

/**
 * The stable code of a provider failure, as a run records it:
 * `provider_unavailable` may work on another try, `provider_rejected` will not
 * (a retired model, a refused request), and `provider_account` is the platform's
 * account refused (its key, its credit): nothing the work did, and nothing works
 * until the platform puts it right (the database marks the provider down, 0255).
 */
export function providerFailureCode(error: unknown): "provider_unavailable" | "provider_rejected" | "provider_account" {
  const failure = classifyAiError(error);
  if (failure.account) return "provider_account";
  return failure.transient ? "provider_unavailable" : "provider_rejected";
}

/**
 * What to write in the server log. Deliberately excludes the message of an
 * unknown error only when it could carry model output — provider SDK messages
 * are kept because they carry the status and the provider's own reason.
 */
export function describeAiFailure(error: unknown): Record<string, unknown> {
  const { status, transient, account } = classifyAiError(error);
  if (isStructuredOutputError(error)) {
    return {
      name: error.name,
      provider: error.provider,
      failure: error.failure,
      finishReason: error.finishReason,
      transient,
    };
  }
  return {
    name: error instanceof Error ? error.name : typeof error,
    status,
    transient,
    account,
    message: error instanceof Error ? error.message.slice(0, 300) : undefined,
  };
}
