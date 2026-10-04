# Premium features

Premium exists because these features need an LLM, web research, or both, and have a real
per-request cost. Everything else stays free.

Gating: `User.tier = premium` (with optional `premiumExpiresAt`). The store SDK on the phone
(RevenueCat) completes the purchase; its webhook (`POST /v1/webhooks/revenuecat`) flips the
tier. Premium routes return HTTP 402 `premium_required` otherwise. A per-user daily AI request
cap (`AI_DAILY_REQUEST_LIMIT`) and token accounting (`AiUsage`) keep costs predictable.

All AI calls use the Anthropic SDK (`@anthropic-ai/sdk`) with `claude-opus-5-5` by default
(`AI_MODEL`), structured outputs via `zodOutputFormat`, and refusal handling
(`stop_reason === "refusal"` surfaces as a clear error, never as a silent empty result).

## 1. Connected accounts (MCP) → watchlist import

`apps/api/src/premium/purchaseImport.ts`

The user connects a grocery / delivery / shopping account that exposes a **remote MCP
server** (URL + access token). We store the token encrypted (AES-256-GCM,
`CONNECTOR_ENCRYPTION_KEY`). On import:

```ts
client.beta.messages.create({
  model, betas: ["mcp-client-2025-11-20"],
  mcp_servers: [{ type: "url", url: connector.mcpUrl, name: connector.provider, authorization_token }],
  tools: [{ type: "mcp_toolset", mcp_server_name: connector.provider }],
  output_config: { format: zodOutputFormat(PurchaseImport) },
  messages: [{ role: "user", content: "Import my purchases from the last 6 months." }],
});
```

Claude calls the retailer's MCP tools itself (order history, product lookups) and returns a
typed list `{name, brand, upc, category, lastPurchasedAt, timesPurchased}`. `materialize()`
de-duplicates against the existing watchlist, creates `WatchItem`s tagged
`importedFrom`, and immediately back-fills alerts for anything already recalled.

Why MCP: we never write or maintain a retailer integration. Any account that speaks MCP
works, including ones that don't exist yet. The `PROVIDER_PRESETS` table in
`routes/premium.ts` is where official MCP URLs go as retailers publish them; until then users
can paste a URL (e.g. a self-hosted bridge).

## 2. Restaurant tracking

`apps/api/src/premium/restaurantResearch.ts`

Adding a `kind: "restaurant"` watch item queues a research job. The worker runs Claude with the
server-side **web search tool** (`web_search_20260209`, up to 8 searches, user location hint
from city/state) and a structured output schema:

- `suppliers[]` — distributors (Sysco, US Foods…), producers, brands, signature ingredients,
  each marked confirmed / likely / guess with a source URL.
- `riskSignals[]` — inspection results, closures, illness reports, food-safety review themes.
- `summary`, `sources[]`.

`applyResearch()` merges confirmed/likely supplier names into the item's `terms` (generic
words like "chicken" are filtered), stores the research JSON and summary on the item, and runs
the matcher so existing supplier recalls appear at once. From then on the normal ingest-time
matching alerts the user whenever a supplier is recalled (`reason: restaurant_supplier`).
Users can re-run research from the app; results are cached on the item.

`pause_turn` from long search turns is resumed up to 3 times; refusals surface as errors.

## 3. AI label identification

`apps/api/src/premium/scanIdentify.ts`

Free users get on-device OCR. When the photo is hard (curved can, glare, handwriting) premium
users can send the image: Claude vision returns `{brand, productName, variant, upc,
lotOrDateCodes, category, searchTerms, confidence}` at `effort: "low"`, and the result is
matched like any scan. Images are not stored.

## Cost notes

- Imports and research are the expensive calls (tool loops); vision identification is cheap.
- `AiUsage` records input/output/cache tokens per feature per user; `GET /v1/premium/usage`
  exposes the last 24h to the app.
- System prompts are stable strings so prompt caching applies across users.
