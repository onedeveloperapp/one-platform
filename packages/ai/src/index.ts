import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";
import { OpenAiProvider } from "./providers/openai";
import { OpenRouterProvider } from "./providers/openrouter";
import { type AiProviderName, AI_PROVIDERS, type ChatProvider } from "./types";

export * from "./types";
export * from "./errors";
export * from "./strict-schema";

export const isAnthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
export const isGeminiConfigured = Boolean(process.env.GEMINI_API_KEY);
export const isOpenAiConfigured = Boolean(process.env.OPENAI_API_KEY);
export const isOpenRouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);

export function getChatProvider(name: AiProviderName): ChatProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "openai":
      return new OpenAiProvider();
    case "openrouter":
      return new OpenRouterProvider();
  }
}

/**
 * Which providers actually have a key in this environment.
 *
 * The operator's console says which tasks point at a provider with no key.
 * A run on such a provider is a recorded failure: silently falling back to
 * another would send a firm's data somewhere nobody chose.
 */
export function configuredProviders(): Record<AiProviderName, boolean> {
  return {
    anthropic: isAnthropicConfigured,
    gemini: isGeminiConfigured,
    openai: isOpenAiConfigured,
    openrouter: isOpenRouterConfigured,
  };
}

export { AI_PROVIDERS };
