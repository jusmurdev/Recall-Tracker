import { toGeminiSchema } from "../schema.js";
import { AiProviderError, AiRefusalError, parseJsonLoose, type AiProvider, type Capability, type Fetcher, type StructuredRequest, type StructuredResult } from "../provider.js";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  error?: { message?: string };
}

/**
 * Google Gemini (generateContent): JSON response schema, inline images, Google Search grounding.
 * Grounding and JSON mode cannot be combined in one call, so a grounded request runs as two:
 * research in free text, then convert to the schema. No MCP connector.
 */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(["structured", "vision", "webSearch"]);
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: Fetcher = (u, i) => fetch(u, i),
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta",
  ) {}

  private async call(body: Record<string, unknown>): Promise<GeminiResponse> {
    const res = await this.fetcher(`${this.baseUrl}/models/${this.model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) throw new AiProviderError(this.name, res.status, json.error?.message ?? `HTTP ${res.status}`);
    if (json.promptFeedback?.blockReason) throw new AiRefusalError(`Blocked: ${json.promptFeedback.blockReason}`);
    return json;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const parts: unknown[] = [];
    for (const img of req.images ?? []) parts.push({ inlineData: { mimeType: img.mediaType, data: img.base64 } });
    parts.push({ text: req.prompt });
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const add = (u: GeminiResponse["usageMetadata"]) => {
      usage.inputTokens += u?.promptTokenCount ?? 0;
      usage.outputTokens += u?.candidatesTokenCount ?? 0;
      usage.cacheReadTokens += u?.cachedContentTokenCount ?? 0;
    };
    const system = req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {};
    let researchText: string | null = null;
    if (req.webSearch) {
      const grounded = await this.call({ ...system, contents: [{ role: "user", parts }], tools: [{ googleSearch: {} }], generationConfig: { maxOutputTokens: req.maxTokens ?? 8000 } });
      add(grounded.usageMetadata);
      researchText = grounded.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
      if (!researchText) throw new AiProviderError(this.name, null, "empty grounded response");
    }
    const finalParts = researchText ? [{ text: `Convert these research notes into the required JSON exactly. Notes:\n\n${researchText}` }] : parts;
    const json = await this.call({
      ...system,
      contents: [{ role: "user", parts: finalParts }],
      generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(req.schema), maxOutputTokens: req.maxTokens ?? 8000 },
    });
    add(json.usageMetadata);
    const cand = json.candidates?.[0];
    if (cand?.finishReason === "SAFETY") throw new AiRefusalError();
    const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) throw new AiProviderError(this.name, null, "empty response");
    return { data: req.schema.parse(parseJsonLoose(text)), usage, provider: this.name, model: this.model };
  }
}
