import { stripNullsForOptionals, toStrictJsonSchema } from "../schema.js";
import { AiProviderError, parseJsonLoose, type AiProvider, type Capability, type Fetcher, type StructuredRequest, type StructuredResult } from "../provider.js";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Any OpenAI-compatible chat-completions endpoint: Ollama, LM Studio, Groq, Together, Mistral,
 * vLLM… Structured output via `response_format: json_schema` (falls back to json_object if the
 * server rejects it), optional vision. No hosted web search or MCP.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible" as const;
  readonly capabilities: ReadonlySet<Capability>;
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
    private readonly apiKey: string | undefined,
    opts: { vision?: boolean } = {},
    private readonly fetcher: Fetcher = (u, i) => fetch(u, i),
  ) {
    this.capabilities = new Set<Capability>(opts.vision ? ["structured", "vision"] : ["structured"]);
  }

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const content: unknown[] = [];
    for (const img of req.images ?? []) content.push({ type: "image_url", image_url: { url: `data:${img.mediaType};base64,${img.base64}` } });
    content.push({ type: "text", text: req.prompt });
    const schema = toStrictJsonSchema(req.schema);
    const messages = [...(req.system ? [{ role: "system", content: `${req.system}\n\nRespond with JSON only, matching this schema:\n${JSON.stringify(schema)}` }] : [{ role: "system", content: `Respond with JSON only, matching this schema:\n${JSON.stringify(schema)}` }]), { role: "user", content }];
    const attempt = async (format: unknown) => {
      const res = await this.fetcher(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, messages, response_format: format, max_tokens: req.maxTokens ?? 8000, temperature: 0 }),
      });
      const json = (await res.json().catch(() => ({}))) as ChatResponse;
      return { res, json };
    };
    let { res, json } = await attempt({ type: "json_schema", json_schema: { name: "result", strict: true, schema } });
    if (!res.ok && (res.status === 400 || res.status === 422)) ({ res, json } = await attempt({ type: "json_object" }));
    if (!res.ok) throw new AiProviderError(this.name, res.status, json.error?.message ?? `HTTP ${res.status}`);
    const choice = json.choices?.[0];
    if (choice?.message?.refusal) throw new AiProviderError(this.name, null, choice.message.refusal);
    const text = choice?.message?.content ?? "";
    if (!text) throw new AiProviderError(this.name, null, "empty response");
    return { data: req.schema.parse(stripNullsForOptionals(parseJsonLoose(text), req.schema)), usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 }, provider: this.name, model: this.model };
  }
}
