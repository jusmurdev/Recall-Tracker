import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";

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

let cached: Anthropic | null = null;

/** Lazily constructed Anthropic client; throws a typed error when no key is configured. */
export function claude(): Anthropic {
  if (!env().ANTHROPIC_API_KEY) throw new PremiumUnavailableError();
  if (!cached) cached = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 10 * 60_000 });
  return cached;
}

/** Test seam. */
export function setClaudeClient(client: Anthropic | null): void {
  cached = client;
}

export function model(): string {
  return env().AI_MODEL;
}

/** Enforce the per-user daily request cap before an AI call. */
export async function assertQuota(userId: string): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600_000);
  const used = await prisma.aiUsage.count({ where: { userId, createdAt: { gte: since } } });
  if (used >= env().AI_DAILY_REQUEST_LIMIT) throw new QuotaExceededError();
}

export async function recordUsage(userId: string | null, feature: string, usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null } | undefined, usedModel = model()): Promise<void> {
  await prisma.aiUsage.create({
    data: {
      userId,
      feature,
      model: usedModel,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    },
  });
}

/** Pull the text blocks out of a response, joined. */
export function textOf(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/** Parse a JSON structured-output response, tolerating code fences. */
export function parseJsonOutput<T>(text: string, parse: (v: unknown) => T): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return parse(JSON.parse(trimmed));
}
