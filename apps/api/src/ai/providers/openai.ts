import { stripNullsForOptionals, toStrictJsonSchema } from "../schema.js";
import { AiProviderError, AiRefusalError, parseJsonLoose, type AiProvider, type Capability, type Fetcher, type StructuredRequest, type StructuredResult } from "../provider.js";

interface ResponsesOutput {
  id?: string;
  status?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string; refusal?: string }> }>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string };
  incomplete_details?: { reason?: string };
}

/**
 * OpenAI Responses API: JSON-schema structured output, image input, hosted web search, remote
 * MCP tool. Raw HTTP so the request shape is explicit and testable.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(["structured", "vision", "webSearch", "mcp"]);
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetcher: Fetcher = (u, i) => fetch(u, i),
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const content: unknown[] = [];
    for (const img of req.images ?? []) content.push({ type: "input_image", image_url: `data:${img.mediaType};base64,${img.base64}`, detail: "high" });
    content.push({ type: "input_text", text: req.prompt });
    const tools: unknown[] = [];
    if (req.webSearch) tools.push({ type: "web_search", ...(req.webSearch.city || req.webSearch.region ? { user_location: { type: "approximate", country: "US", city: req.webSearch.city ?? undefined, region: req.webSearch.region ?? undefined } } : {}) });
    if (req.mcp) tools.push({ type: "mcp", server_label: req.mcp.name, server_url: req.mcp.url, require_approval: "never", ...(req.mcp.token ? { headers: { Authorization: `Bearer ${req.mcp.token}` } } : {}) });
    const body = {
      model: this.model,
      ...(req.system ? { instructions: req.system } : {}),
      input: [{ role: "user", content }],
      ...(tools.length ? { tools } : {}),
      text: { format: { type: "json_schema", name: "result", strict: true, schema: toStrictJsonSchema(req.schema) } },
      max_output_tokens: req.maxTokens ?? 16000,
      ...(req.effort ? { reasoning: { effort: req.effort } } : {}),
    };
    const res = await this.fetcher(`${this.baseUrl}/responses`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as ResponsesOutput;
    if (!res.ok) throw new AiProviderError(this.name, res.status, json.error?.message ?? `HTTP ${res.status}`);
    const message = json.output?.find((o) => o.type === "message");
    const refusal = message?.content?.find((c) => c.type === "refusal");
    if (refusal) throw new AiRefusalError(refusal.refusal);
    const text = json.output_text ?? message?.content?.filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("\n") ?? "";
    if (!text) throw new AiProviderError(this.name, null, json.incomplete_details?.reason ?? "empty response");
    return {
      data: req.schema.parse(stripNullsForOptionals(parseJsonLoose(text), req.schema)),
      usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0, cacheReadTokens: json.usage?.input_tokens_details?.cached_tokens ?? 0 },
      provider: this.name,
      model: this.model,
    };
  }
}
