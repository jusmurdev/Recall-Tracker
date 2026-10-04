/**
 * Provider registry. AI_PROVIDER picks the default; AI_PROVIDER_FALLBACKS lists others to try
 * when the default lacks a capability (e.g. Gemini has no MCP connector → use Claude/OpenAI
 * for purchase import) or fails with a provider error.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAiCompatibleProvider } from "./providers/openaiCompatible.js";
import { OpenAiProvider } from "./providers/openai.js";
import { AiProviderError, AiRefusalError, requirementsOf, type AiProvider, type Capability, type ProviderName, type StructuredRequest, type StructuredResult } from "./provider.js";

export { AiProviderError, AiRefusalError } from "./provider.js";
export type { AiProvider, Capability, ProviderName, StructuredRequest, StructuredResult } from "./provider.js";

export class PremiumUnavailableError extends Error {
  constructor(message = "AI features are not configured on this server") {
    super(message);
  }
}
export class QuotaExceededError extends Error {
  constructor() {
    super("Daily AI request limit reached. Try again tomorrow.");
  }
}

let cache: Map<ProviderName, AiProvider> | null = null;
let overrides: Partial<Record<ProviderName, AiProvider>> = {};

/** Test seam: inject fake providers (pass null to reset). */
export function setProviderOverrides(o: Partial<Record<ProviderName, AiProvider>> | null): void {
  overrides = o ?? {};
  cache = null;
}

function build(name: ProviderName): AiProvider | null {
  const e = env();
  switch (name) {
    case "anthropic":
      return e.ANTHROPIC_API_KEY ? new AnthropicProvider(new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 10 * 60_000 }), e.AI_MODEL) : null;
    case "openai":
      return e.OPENAI_API_KEY ? new OpenAiProvider(e.OPENAI_API_KEY, e.OPENAI_MODEL, undefined, e.OPENAI_BASE_URL) : null;
    case "gemini":
      return e.GEMINI_API_KEY ? new GeminiProvider(e.GEMINI_API_KEY, e.GEMINI_MODEL) : null;
    case "openai-compatible":
      return e.AI_COMPAT_BASE_URL && e.AI_COMPAT_MODEL ? new OpenAiCompatibleProvider(e.AI_COMPAT_BASE_URL, e.AI_COMPAT_MODEL, e.AI_COMPAT_API_KEY, { vision: e.AI_COMPAT_VISION }) : null;
  }
}

function providers(): Map<ProviderName, AiProvider> {
  if (cache) return cache;
  cache = new Map();
  const order: ProviderName[] = [env().AI_PROVIDER, ...env().AI_PROVIDER_FALLBACKS];
  for (const name of order) {
    if (cache.has(name)) continue;
    const p = overrides[name] ?? build(name);
    if (p) cache.set(name, p);
  }
  return cache;
}

/** Which configured providers (in preference order) can serve these capabilities. */
export function candidateProviders(required: Capability[]): AiProvider[] {
  return [...providers().values()].filter((p) => required.every((c) => p.capabilities.has(c)));
}

export function listProviders(): Array<{ name: ProviderName; model: string; capabilities: Capability[]; primary: boolean }> {
  return [...providers().values()].map((p) => ({ name: p.name, model: p.model, capabilities: [...p.capabilities], primary: p.name === env().AI_PROVIDER }));
}

/** Enforce the per-user daily request cap before an AI call. */
export async function assertQuota(userId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const used = await prisma.aiUsage.count({ where: { userId, createdAt: { gte: since } } });
  if (used >= env().AI_DAILY_REQUEST_LIMIT) throw new QuotaExceededError();
}

/**
 * Run a structured request on the best available provider, falling over to the next capable
 * one on provider errors (not on refusals or schema failures, which would repeat). Records
 * usage against the user (or null for system work).
 */
export async function runStructured<T>(userId: string | null, req: StructuredRequest<T>, opts: { provider?: AiProvider } = {}): Promise<StructuredResult<T>> {
  const required = requirementsOf(req);
  const candidates = opts.provider ? [opts.provider] : candidateProviders(required);
  if (!candidates.length) {
    const have = listProviders();
    throw new PremiumUnavailableError(have.length ? `No configured AI provider supports ${required.join("+")} (configured: ${have.map((h) => h.name).join(", ")})` : undefined);
  }
  let lastErr: unknown = null;
  for (const provider of candidates) {
    try {
      const result = await provider.structured(req);
      await prisma.aiUsage.create({ data: { userId, feature: req.feature, model: result.model, provider: result.provider, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cacheReadTokens: result.usage.cacheReadTokens ?? 0 } });
      return result;
    } catch (err) {
      if (err instanceof AiRefusalError) throw err;
      lastErr = err;
      logger.warn({ provider: provider.name, feature: req.feature, err: err instanceof Error ? err.message : String(err) }, "ai provider failed; trying next");
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
