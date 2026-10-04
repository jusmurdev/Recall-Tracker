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

### Research is shared, not per user

Research is expensive (a Claude turn with up to 8 web searches), and thousands of people
eat at the same places. So research is stored once per real-world restaurant in
`RestaurantProfile` and reused by every user who tracks it:

- **Identity.** `restaurantKey()` normalises `{name, city, state, website}` into one key:
  the website host when known (`host:joescrabshack.com`), else
  `name:<normalised name>|<city>|<ST>` with punctuation and filler words
  ("restaurant", "cafe", "the") removed. "Joe's Crab Shack, Austin TX" and
  "joes crab shack / austin / tx" share one profile.
- **Adding a restaurant** (`POST /v1/watchlist`, `kind: "restaurant"`): the item is linked
  to the profile. If the profile has fresh research (`researchedAt` within
  `RESTAURANT_RESEARCH_TTL_DAYS`, default 90) it is applied immediately: supplier terms are
  merged into the user's item, existing supplier recalls become alerts, and the response says
  `research.status = "cached"`. No AI call, no quota charge, `cacheHits` is incremented.
  Otherwise one research job is queued with `jobId = research:<profileId>`, so several users
  adding the same unknown restaurant at once still trigger a single run.
- **Worker** (`researchProfile`): re-checks freshness first (another job may have finished),
  then runs Claude, stores `summary`, `supplierTerms`, `researchJson`, `researchedAt` on the
  profile and applies them to *every* linked watch item that is behind. The requesting user's
  quota is charged; everyone else rides along free. If the AI fails and an older result exists,
  the old result stays `ready` and the error is recorded; with no prior result the profile is
  marked `failed` so the app can say so.
- **Refresh** (`POST /v1/premium/restaurants/:id/refresh`) re-runs only when the shared
  research is at least `RESTAURANT_RESEARCH_MIN_REFRESH_DAYS` old (default 7), so one user
  cannot burn research for everyone. Otherwise it returns `queued: false, reason: "too_recent"`
  with `nextRefreshAt`.
- **Lookup** (`GET /v1/premium/restaurants/lookup?name&city&state&website`) tells the app
  before the user commits whether research already exists and how many people track it.
- **Detail** (`GET /v1/premium/restaurants/:id`) is served from the profile and includes
  `shared: {trackedBy, researchCount, cacheHits, fresh, canRefresh}`.

Each watch item keeps a snapshot (`researchSummary`, `researchUpdatedAt`, `researchJson`)
so deleting or re-researching a profile never blanks what a user already sees.

### Health inspection grades

Grades are stored on the same shared profile and refreshed by the daily maintenance job
for every restaurant anyone tracks, so a venue is looked up once per week, not once per user.

- **Open-data adapters** (`apps/api/src/inspections/sources/`): NYC DOHMH (letter grade +
  points, violations per inspection) and Chicago CDPH (Pass / Pass w/ Conditions / Fail,
  violations text). Each adapter decides whether it `covers()` a city/state, finds the venue
  by fuzzy name + distance (`match.ts`), and returns normalised `InspectionRecord`s. Adding a
  county is one adapter file plus a fixture. A Socrata app token (`SOCRATA_APP_TOKEN`) raises
  rate limits.
- **AI fallback**: elsewhere, the research prompt also asks for the latest official grade with
  its source page; it is stored through the same sync path (`gradeSource = ai_research`) and
  never overrides a structured source.
- **`syncGrade()`** upserts `RestaurantInspection` rows, sets the profile's current grade /
  score / scale, and on change writes a `RestaurantNotice` for every tracker. Drops (and a
  first grade that is poor) are pushed; improvements only appear in-app. `interpretGrade()`
  maps any scale to good / ok / poor so the app can colour it.
- **Catalog**: `GET /v1/premium/restaurants/search` (fuzzy name, optional distance ranking)
  shows research status, grade and tracker count so a user picks the existing entry
  (`restaurant.profileId`) instead of creating a duplicate. `GET …/updates` lists notices.
- **Durability**: removing a watch item or deleting an account never deletes the profile,
  its inspections or research. The maintenance job prunes only profiles that are untracked,
  were never researched, have no grade, and have not been requested for
  `PROFILE_PRUNE_DAYS`. Tracked profiles get stale research refreshed at system expense.

### What the research does

The worker runs Claude with the server-side **web search tool** (`web_search_20260209`, up to
8 searches, user location hint from city/state) and a structured output schema:

- `suppliers[]` — distributors (Sysco, US Foods…), producers, brands, signature ingredients,
  each marked confirmed / likely / guess with a source URL.
- `riskSignals[]` — inspection results, closures, illness reports, food-safety review themes.
- `summary`, `sources[]`.

`extractSupplierTerms()` keeps confirmed/likely names and drops generic words ("chicken",
"rice") that would match every recall. Those terms are merged into each linked item's
`terms`, so the normal ingest-time matching alerts users whenever a supplier is recalled
(`reason: restaurant_supplier`). `pause_turn` from long search turns is resumed up to 3
times; refusals surface as errors.

## 3. AI label identification

`apps/api/src/premium/scanIdentify.ts`

Free users get on-device OCR. When the photo is hard (curved can, glare, handwriting) premium
users can send the image: Claude vision returns `{brand, productName, variant, upc,
lotOrDateCodes, category, searchTerms, confidence}` at `effort: "low"`, and the result is
matched like any scan. Images are not stored.

## Cost notes

- Imports and research are the expensive calls (tool loops); vision identification is cheap.
- Restaurant research cost is amortised across users: `RestaurantProfile.researchCount` vs
  `cacheHits` shows the ratio per restaurant.
- `AiUsage` records input/output/cache tokens per feature per user; `GET /v1/premium/usage`
  exposes the last 24h to the app.
- System prompts are stable strings so prompt caching applies across users.
