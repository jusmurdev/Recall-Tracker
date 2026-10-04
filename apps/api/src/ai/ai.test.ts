import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { resetEnvCache } from "../config/env.js";
import { prisma } from "../db/client.js";
import { sha256 } from "../lib/crypto.js";
import { resetDb } from "../test/db.js";
import { candidateProviders, PremiumUnavailableError, runStructured, setProviderOverrides } from "./index.js";
import { AiProviderError, AiRefusalError, parseJsonLoose, type AiProvider, type Fetcher } from "./provider.js";
import { GeminiProvider } from "./providers/gemini.js";
import { OpenAiCompatibleProvider } from "./providers/openaiCompatible.js";
import { OpenAiProvider } from "./providers/openai.js";
import { toGeminiSchema, toStrictJsonSchema } from "./schema.js";
import { Research } from "../premium/restaurantResearch.js";
import { Identified } from "../premium/scanIdentify.js";
import { PurchaseImport } from "../premium/purchaseImport.js";
import { DecodedReceipt } from "../premium/receiptDecode.js";

const Answer = z.object({ name: z.string(), count: z.number().int().nullable(), tags: z.array(z.string()).max(3), note: z.string().optional() });

/** Records requests, returns canned bodies. */
function fakeFetch(responder: (url: string, body: Record<string, unknown>) => { status?: number; json: unknown }): { fetcher: Fetcher; calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetcher: Fetcher = async (url, init) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body, headers: (init.headers as Record<string, string>) ?? {} });
    const r = responder(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { fetcher, calls };
}

describe("schema dialects", () => {
  it("strict (OpenAI): every property required, optionals nullable, no additional properties", () => {
    const s = toStrictJsonSchema(Answer) as { required: string[]; properties: Record<string, { anyOf?: unknown[] }>; additionalProperties: boolean };
    expect(s.required.sort()).toEqual(["count", "name", "note", "tags"]);
    expect(s.properties.note!.anyOf).toBeTruthy();
    expect(s.additionalProperties).toBe(false);
    // All four production schemas convert without throwing.
    for (const sc of [Research, Identified, PurchaseImport, DecodedReceipt]) expect(() => toStrictJsonSchema(sc)).not.toThrow();
  });
  it("gemini: nullable flag instead of anyOf-null, no additionalProperties", () => {
    const g = toGeminiSchema(Answer) as { properties: Record<string, Record<string, unknown>>; additionalProperties?: unknown };
    expect(g.additionalProperties).toBeUndefined();
    expect(g.properties.count).toMatchObject({ type: "integer", nullable: true });
    expect(g.properties.note).toMatchObject({ type: "string", nullable: true });
    const r = toGeminiSchema(Research) as { properties: Record<string, Record<string, unknown>> };
    expect(r.properties.inspection).toMatchObject({ type: "object", nullable: true });
  });
  it("parses JSON wrapped in fences or prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(() => parseJsonLoose("nope")).toThrow();
  });
});

describe("OpenAI provider", () => {
  it("sends a strict json_schema response format, images, web search and MCP tools; parses output_text", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ json: { output: [{ type: "message", content: [{ type: "output_text", text: '{"name":"x","count":2,"tags":["a"],"note":null}' }] }], usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 3 } } } }));
    const p = new OpenAiProvider("sk-test", "gpt-test", fetcher);
    const r = await p.structured({ feature: "t", system: "sys", prompt: "hi", schema: Answer, images: [{ base64: "AAAA", mediaType: "image/png" }], webSearch: { city: "Austin", region: "TX" }, mcp: { name: "shop", url: "https://mcp.example.com", token: "tok" }, effort: "low" });
    expect(r).toMatchObject({ data: { name: "x", count: 2, tags: ["a"] }, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 }, provider: "openai", model: "gpt-test" });
    expect("note" in r.data).toBe(false); // strict-mode null for an optional field is dropped, not a parse error
    const call = calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/responses");
    expect(call.headers.authorization).toBe("Bearer sk-test");
    expect(call.body.instructions).toBe("sys");
    const text = call.body.text as { format: { type: string; strict: boolean; schema: { additionalProperties: boolean } } };
    expect(text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(text.format.schema.additionalProperties).toBe(false);
    const tools = call.body.tools as Array<Record<string, unknown>>;
    expect(tools.find((t) => t.type === "web_search")).toMatchObject({ user_location: { city: "Austin", region: "TX" } });
    expect(tools.find((t) => t.type === "mcp")).toMatchObject({ server_label: "shop", server_url: "https://mcp.example.com", headers: { Authorization: "Bearer tok" }, require_approval: "never" });
    const input = call.body.input as Array<{ content: Array<{ type: string }> }>;
    expect(input[0]!.content.map((c) => c.type)).toEqual(["input_image", "input_text"]);
    expect(call.body.reasoning).toEqual({ effort: "low" });
  });
  it("surfaces refusals and HTTP errors distinctly", async () => {
    const refusing = new OpenAiProvider("k", "m", fakeFetch(() => ({ json: { output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] } })).fetcher);
    await expect(refusing.structured({ feature: "t", prompt: "p", schema: Answer })).rejects.toBeInstanceOf(AiRefusalError);
    const failing = new OpenAiProvider("k", "m", fakeFetch(() => ({ status: 429, json: { error: { message: "rate limited" } } })).fetcher);
    await expect(failing.structured({ feature: "t", prompt: "p", schema: Answer })).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe("Gemini provider", () => {
  it("uses responseSchema, inline images, and a two-step grounded flow for web search", async () => {
    let n = 0;
    const { fetcher, calls } = fakeFetch(() => {
      n += 1;
      return n === 1
        ? { json: { candidates: [{ content: { parts: [{ text: "Notes: name is y, count 1, tags b" }] } }], usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 } } }
        : { json: { candidates: [{ content: { parts: [{ text: '{"name":"y","count":1,"tags":["b"]}' }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } } };
    });
    const p = new GeminiProvider("gk", "gemini-test", fetcher);
    const r = await p.structured({ feature: "t", system: "sys", prompt: "find", schema: Answer, images: [{ base64: "BBBB", mediaType: "image/jpeg" }], webSearch: { maxUses: 3 } });
    expect(r.data).toEqual({ name: "y", count: 1, tags: ["b"] });
    expect(r.usage).toEqual({ inputTokens: 11, outputTokens: 5, cacheReadTokens: 0 });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain("/models/gemini-test:generateContent");
    expect(calls[0]!.headers["x-goog-api-key"]).toBe("gk");
    expect(calls[0]!.body.tools).toEqual([{ googleSearch: {} }]);
    expect((calls[0]!.body.contents as Array<{ parts: unknown[] }>)[0]!.parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "BBBB" } });
    const gen = calls[1]!.body.generationConfig as { responseMimeType: string; responseSchema: { additionalProperties?: unknown } };
    expect(gen.responseMimeType).toBe("application/json");
    expect(gen.responseSchema.additionalProperties).toBeUndefined();
    expect(calls[1]!.body.tools).toBeUndefined();
  });
  it("treats safety blocks as refusals", async () => {
    const p = new GeminiProvider("gk", "m", fakeFetch(() => ({ json: { promptFeedback: { blockReason: "SAFETY" } } })).fetcher);
    await expect(p.structured({ feature: "t", prompt: "p", schema: Answer })).rejects.toBeInstanceOf(AiRefusalError);
  });
});

describe("OpenAI-compatible provider", () => {
  it("falls back from json_schema to json_object when the server rejects it", async () => {
    let n = 0;
    const { fetcher, calls } = fakeFetch(() => {
      n += 1;
      return n === 1 ? { status: 400, json: { error: { message: "response_format not supported" } } } : { json: { choices: [{ message: { content: '{"name":"z","count":null,"tags":[]}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } } };
    });
    const p = new OpenAiCompatibleProvider("http://localhost:11434/v1/", "llama", undefined, {}, fetcher);
    const r = await p.structured({ feature: "t", prompt: "p", schema: Answer });
    expect(r.data.name).toBe("z");
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect((calls[0]!.body.response_format as { type: string }).type).toBe("json_schema");
    expect((calls[1]!.body.response_format as { type: string }).type).toBe("json_object");
    expect(p.capabilities.has("vision")).toBe(false);
    expect(new OpenAiCompatibleProvider("http://x", "m", "k", { vision: true }).capabilities.has("vision")).toBe(true);
  });
});

describe("registry", () => {
  const fake = (name: AiProvider["name"], caps: AiProvider["capabilities"], impl?: AiProvider["structured"]): AiProvider => ({
    name,
    model: `${name}-model`,
    capabilities: caps,
    structured: impl ?? (async () => ({ data: { name: name, count: null, tags: [] } as never, usage: { inputTokens: 1, outputTokens: 1 }, provider: name, model: `${name}-model` })),
  });
  let userId: string;
  beforeEach(async () => {
    await resetDb();
    userId = (await prisma.user.create({ data: { installId: "ai-1", tokenHash: sha256("ai-1"), tier: "premium" } })).id;
    process.env.AI_PROVIDER = "gemini";
    process.env.AI_PROVIDER_FALLBACKS = "openai,anthropic";
    resetEnvCache();
  });
  afterEach(async () => {
    setProviderOverrides(null);
    delete process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER_FALLBACKS;
    resetEnvCache();
    await prisma.$disconnect();
  });

  it("picks the first configured provider with the needed capabilities and records usage per provider", async () => {
    setProviderOverrides({ gemini: fake("gemini", new Set(["structured", "vision", "webSearch"])), openai: fake("openai", new Set(["structured", "vision", "webSearch", "mcp"])) });
    expect(candidateProviders(["structured"]).map((p) => p.name)).toEqual(["gemini", "openai"]);
    expect(candidateProviders(["mcp"]).map((p) => p.name)).toEqual(["openai"]);
    const plain = await runStructured(userId, { feature: "f1", prompt: "p", schema: Answer });
    expect(plain.provider).toBe("gemini");
    const mcp = await runStructured(userId, { feature: "f2", prompt: "p", schema: Answer, mcp: { name: "s", url: "https://x" } });
    expect(mcp.provider).toBe("openai");
    const usage = await prisma.aiUsage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    expect(usage.map((u) => [u.feature, u.provider])).toEqual([["f1", "gemini"], ["f2", "openai"]]);
  });

  it("fails over on provider errors but not on refusals", async () => {
    const broken = fake("gemini", new Set(["structured"]), async () => { throw new AiProviderError("gemini", 500, "down"); });
    setProviderOverrides({ gemini: broken, openai: fake("openai", new Set(["structured"])) });
    expect((await runStructured(userId, { feature: "f", prompt: "p", schema: Answer })).provider).toBe("openai");
    const refusing = fake("gemini", new Set(["structured"]), async () => { throw new AiRefusalError(); });
    setProviderOverrides({ gemini: refusing, openai: fake("openai", new Set(["structured"])) });
    await expect(runStructured(userId, { feature: "f", prompt: "p", schema: Answer })).rejects.toBeInstanceOf(AiRefusalError);
  });

  it("explains when nothing configured can serve a request", async () => {
    setProviderOverrides({ gemini: fake("gemini", new Set(["structured"])) });
    await expect(runStructured(userId, { feature: "f", prompt: "p", schema: Answer, mcp: { name: "s", url: "https://x" } })).rejects.toBeInstanceOf(PremiumUnavailableError);
    setProviderOverrides({});
    await expect(runStructured(userId, { feature: "f", prompt: "p", schema: Answer })).rejects.toThrow(/not configured/);
  });
});
