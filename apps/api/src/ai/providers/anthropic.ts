import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { AiRefusalError, parseJsonLoose, type AiProvider, type Capability, type StructuredRequest, type StructuredResult } from "../provider.js";

/** Claude via the official SDK: structured outputs, vision, server-side web search, MCP connector. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic" as const;
  readonly capabilities: ReadonlySet<Capability> = new Set<Capability>(["structured", "vision", "webSearch", "mcp"]);
  constructor(
    private readonly client: Anthropic,
    readonly model: string,
  ) {}

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const content: Anthropic.ContentBlockParam[] = [];
    for (const img of req.images ?? []) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
    content.push({ type: "text", text: req.prompt });
    const format = zodOutputFormat(req.schema);
    const base = {
      model: this.model,
      max_tokens: req.maxTokens ?? 16000,
      ...(req.system ? { system: req.system } : {}),
      output_config: { format, ...(req.effort ? { effort: req.effort } : {}) },
    };
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    const addUsage = (u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null } | undefined) => {
      usage.inputTokens += u?.input_tokens ?? 0;
      usage.outputTokens += u?.output_tokens ?? 0;
      usage.cacheReadTokens += u?.cache_read_input_tokens ?? 0;
    };

    if (req.mcp) {
      const response = await this.client.beta.messages.create({
        ...base,
        betas: ["mcp-client-2025-11-20"],
        mcp_servers: [{ type: "url", url: req.mcp.url, name: req.mcp.name, ...(req.mcp.token ? { authorization_token: req.mcp.token } : {}) }],
        tools: [{ type: "mcp_toolset", mcp_server_name: req.mcp.name }],
        messages: [{ role: "user", content }],
      });
      addUsage(response.usage);
      if (response.stop_reason === "refusal") throw new AiRefusalError();
      return { data: req.schema.parse(parseJsonLoose(text(response.content))), usage, provider: this.name, model: this.model };
    }

    const tools: Anthropic.ToolUnion[] = req.webSearch
      ? [{ type: "web_search_20260209", name: "web_search", max_uses: req.webSearch.maxUses ?? 8, user_location: { type: "approximate", country: "US", ...(req.webSearch.city ? { city: req.webSearch.city } : {}), ...(req.webSearch.region ? { region: req.webSearch.region } : {}) } }]
      : [];
    const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
    let response = await this.client.messages.create({ ...base, ...(tools.length ? { tools } : {}), messages });
    addUsage(response.usage);
    let resumes = 0;
    while (response.stop_reason === "pause_turn" && resumes < 3) {
      resumes += 1;
      messages.push({ role: "assistant", content: response.content });
      response = await this.client.messages.create({ ...base, ...(tools.length ? { tools } : {}), messages });
      addUsage(response.usage);
    }
    if (response.stop_reason === "refusal") throw new AiRefusalError();
    return { data: req.schema.parse(parseJsonLoose(text(response.content))), usage, provider: this.name, model: this.model };
  }
}

function text(content: Array<{ type: string; text?: string }>): string {
  return content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
}
