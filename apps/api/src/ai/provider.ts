/**
 * Provider-agnostic AI layer. Every premium feature asks for a structured answer to a prompt,
 * optionally with images, web search, or a remote MCP server. Providers declare which of those
 * they can do; the registry picks the first configured provider that can serve the request.
 */
import type { z } from "zod/v4";

export type Capability = "structured" | "vision" | "webSearch" | "mcp";
export type ProviderName = "anthropic" | "openai" | "gemini" | "openai-compatible";

export interface ImageInput {
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface StructuredRequest<T> {
  /** Feature tag for usage accounting ("restaurant_research", "receipt_decode"…). */
  feature: string;
  system?: string;
  prompt: string;
  schema: z.ZodType<T>;
  images?: ImageInput[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  webSearch?: { maxUses?: number; city?: string | null; region?: string | null };
  mcp?: { name: string; url: string; token?: string };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
  provider: ProviderName;
  model: string;
}

export interface AiProvider {
  readonly name: ProviderName;
  readonly model: string;
  readonly capabilities: ReadonlySet<Capability>;
  structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

export class AiRefusalError extends Error {
  constructor(message = "The AI declined this request.") {
    super(message);
  }
}
export class AiProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly status: number | null,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

export function requirementsOf<T>(req: StructuredRequest<T>): Capability[] {
  const caps: Capability[] = ["structured"];
  if (req.images?.length) caps.push("vision");
  if (req.webSearch) caps.push("webSearch");
  if (req.mcp) caps.push("mcp");
  return caps;
}

/** Tolerant JSON parse: strips code fences and leading prose some models add. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model did not return JSON");
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
