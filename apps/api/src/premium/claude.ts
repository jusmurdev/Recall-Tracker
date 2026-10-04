/**
 * Compatibility shim. Premium features now go through the provider-agnostic layer in
 * src/ai (Claude, OpenAI, Gemini, OpenAI-compatible). Kept so existing imports and the
 * test seam (`client` override = Anthropic SDK client) keep working.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { AnthropicProvider } from "../ai/providers/anthropic.js";
import type { AiProvider } from "../ai/provider.js";

export { assertQuota, PremiumUnavailableError, QuotaExceededError } from "../ai/index.js";

export function model(): string {
  return env().AI_MODEL;
}

/** Wrap an Anthropic SDK client (real or stubbed in tests) as a provider. */
export function providerFromClient(client: Anthropic | undefined): AiProvider | undefined {
  return client ? new AnthropicProvider(client, model()) : undefined;
}
