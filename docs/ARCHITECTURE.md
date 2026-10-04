# Architecture

```
                 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  public APIs    │  FDA openFDA │   │  USDA FSIS   │   │     CPSC     │
                 └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
                        │ cron (4h)        │ cron (2h)        │ cron (6h)
                        ▼                  ▼                  ▼
                 ┌─────────────────────────────────────────────────────┐
   worker        │  ingest: fetch window → normalise → hash → upsert    │
   (BullMQ)      │  matching: new/changed recalls × all watch items     │
                 │  push: Expo tickets + receipts                       │
                 │  research: Claude web search for restaurants         │
                 └───────────────┬─────────────────────────────────────┘
                                 │
                 ┌───────────────▼───────────────┐      ┌───────────────┐
                 │   Postgres  (recalls, users,  │      │     Redis     │
                 │   watch items, alerts, usage) │      │  (job queues) │
                 └───────────────┬───────────────┘      └───────────────┘
                                 │
                 ┌───────────────▼───────────────┐
   api (Fastify) │  /v1/recalls  /v1/watchlist   │  ◄── Claude (MCP connector, vision)
                 │  /v1/scan     /v1/alerts      │
                 │  /v1/premium  /v1/webhooks    │
                 └───────────────┬───────────────┘
                                 │ HTTPS, bearer token
                 ┌───────────────▼───────────────┐
   mobile (Expo) │ feed · scan (camera+OCR) ·    │  ◄── Expo push service
                 │ watchlist · alerts · premium  │
                 └───────────────────────────────┘
```

## Why one shared database

Every client hitting openFDA directly would (a) burn the 1,000/day anonymous quota in
minutes, (b) give each user a slightly different view of the world, and (c) make
"alert me when something new appears" impossible without background polling on phones.
Instead, one worker polls each source on a cron, and all users read from Postgres.
Matching also runs server-side at ingest time, so a new recall fans out to every affected
user in one pass and a push goes out within minutes of publication.

## Ingestion (`apps/api/src/ingest`)

- **Adapters** (`sources/fda.ts`, `fsis.ts`, `cpsc.ts`) implement `SourceAdapter.fetch(window)`
  and return `NormalizedRecall[]`. They know the source's quirks (openFDA's `NOT_FOUND` 404
  for empty windows, FSIS Spanish duplicates, CPSC's UPC array) and nothing else.
- **Normalisation** (`normalize.ts`) is shared: UPC extraction, state parsing, brand
  heuristics, HTML stripping, date parsing, content hashing.
- **Runner** (`run.ts`) reads the per-source watermark, fetches `[watermark − 3d, now]`,
  upserts by `(source, sourceId)`, skips rows whose hash is unchanged, and hands new or
  escalated recalls to the matching engine. Every run is logged in `IngestRun`.
- **Fixtures** (`fixtures/*.json`, `fixtureLoader.ts`) are recorded responses so the full
  pipeline runs offline (`INGEST_USE_FIXTURES=1`) and in CI.

Adding a source = one adapter file + one fixture + one line in `sources/index.ts`.
Candidates: NHTSA vehicles/car seats, FDA MedWatch, state health department alerts.

## Matching (`apps/api/src/matching/engine.ts`)

Two directions, same scorer:

- **Recall → watch items** (at ingest). One SQL query per new recall finds watch items whose
  UPC is in the recall, or any of whose terms appear in the recall text verbatim, after
  stripping punctuation, or by `pg_trgm` `word_similarity ≥ 0.72`.
- **Watch item → recalls** (when a user adds/scans something). Keyset-limited search over the
  last 180 days with the same predicates, so the user sees existing recalls instantly.

`scoreMatch` turns (item, recall, matched terms) into `{reason, score, explanation}`:
UPC = 1.0; brand/company hit ≥ 0.75; description-only text ≥ 0.45; scaled by term coverage,
+0.1 for Class I, −0.1 for Class III, ×0.6 when not distributed in the user's state.
Best match per user wins; `(userId, recallId)` is unique so nobody is alerted twice.
Alerts ≥ 0.5 are pushed; the rest just appear in the inbox.

## Restaurant research cache (`premium/restaurantResearch.ts`)

Research results live on `RestaurantProfile`, one row per real-world restaurant
(normalised key from website host or name/city/state), not on the user's watch item. The
first user to add a restaurant triggers one research job; everyone after that gets the
stored result instantly until it is older than `RESTAURANT_RESEARCH_TTL_DAYS`. Job ids are
keyed by profile so concurrent requests collapse into a single AI run, and manual refreshes
are throttled by `RESTAURANT_RESEARCH_MIN_REFRESH_DAYS`. Each watch item keeps a snapshot
of the research it was given. See docs/PREMIUM.md for the full flow.

## Notifications (`notifications/push.ts`)

Expo push in chunks of 100, tickets stored on the alert, `DeviceNotRegistered` disables the
device, receipts checked 15 minutes later. Android channels: `recalls` and `critical-recalls`.

## API (`apps/api/src/api`)

Fastify 5, zod-validated bodies from `@recall/shared`, anonymous bearer auth (`installId` →
token, hashed at rest), rate limited. Premium gating via `requirePremium` (HTTP 402).
Admin endpoints (`/v1/admin/ingest*`) are protected by `ADMIN_TOKEN`.

## Mobile (`apps/mobile`)

Expo Router, React Query, SecureStore for the token. Camera: `expo-camera` for UPC/EAN
barcodes, ML Kit text recognition for labels (lazy-loaded; falls back to manual entry in
Expo Go). Push registration on launch; notification taps deep-link to `/alert/:id`.

## Operations

- `docker compose up` runs postgres, redis, migrations, api, worker.
- Scale workers horizontally; ingestion is `concurrency: 1` per queue to stay polite.
- `GET /v1/recalls/stats` exposes per-source health; `GET /v1/admin/ingest` shows runs.
- Logs are pino JSON in production.

## Roadmap

- Household sharing (one watchlist, several phones).
- Retailer-specific "sold at" matching from CPSC/FDA distribution text.
- State health department feeds and FDA outbreak investigations (CORE).
- Localised push (Spanish; FSIS already publishes Spanish notices).
- On-device embeddings for label → product matching without a server round-trip.
