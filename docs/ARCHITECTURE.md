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
  heuristics, HTML stripping, date parsing, content hashing, and `extractRemedy()` which
  pulls the "consumers should return / discard / contact" sentences out of agency prose.
  Each adapter also fills `codeInfo` (FDA `code_info`, FSIS lot/date phrases, CPSC models)
  so the app can show "check your package".
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

## Location

Location is a phone-side capability with a deliberately thin server footprint:

- **State detection** (`apps/mobile/src/lib/location.ts`, `hooks/useLocationState.ts`):
  `expo-location` + on-device reverse geocoding (Apple's geocoder on iOS, no API key)
  produce a two-letter state. `PUT /v1/me/location` stores it as `lastKnownState`, and as
  `homeState` on first run or when the user taps "Set as home". The server never receives
  coordinates.
- **Ranking + feed**: `scoreMatch` treats home and last-known state as "the user's states"
  and down-ranks (never hides) recalls distributed elsewhere. The feed's `state` filter powers
  the "Near me" pill.
- **Restaurant venues**: `RestaurantProfile.latitude/longitude` (public places) come from the
  phone when the user adds a restaurant on site, from an on-device forward geocode of the typed
  address, or from a nearby pick. `GET /v1/premium/restaurants/nearby` runs a haversine query
  and reports active supplier recalls per venue.
- **Arrival alerts** (`apps/mobile/src/lib/geofence.ts`): `expo-task-manager` +
  `Location.startGeofencingAsync` monitor up to 20 tracked restaurants (the iOS cap). On
  enter, the task fetches that restaurant's current supplier recalls and posts a local
  notification if any exist. Requires "Always" permission on iOS; toggled in Settings.

## Scanning (`scan/`)

- **On-device OCR** (`apps/mobile/modules/vision-ocr`): a local Expo module. iOS uses Apple
  Vision's `VNRecognizeTextRequest` in `.accurate` mode (the neural recogniser, Neural
  Engine on A12+), with language correction off for receipts so SKU codes survive; Android
  uses ML Kit text recognition v2 with the bundled Latin model. Both return every line with a
  normalised bounding box plus a barcode pass (`VNDetectBarcodesRequest` / ML Kit). JS
  (`src/lib/receiptLayout.ts`) regroups lines into rows by vertical position so a receipt's
  descriptions and prices line up before any text leaves the phone. Falls back to the
  `@react-native-ml-kit/text-recognition` package, then to typing.
- **Products**: the phone scans UPC/EAN barcodes with the camera, or snaps the label: OCR
  text plus any barcode found in the still go to `POST /v1/scan/match`, which extracts
  brand/terms (`scan/extract.ts`) and runs the matcher. The screen auto-submits; no form in
  between.
- **Receipts**: `scan/receipt.ts` parses OCR text into line items: detects the store and
  date, drops totals/payments/coupons, merges prices OCR'd onto their own line, handles
  "2 @ 1.29" quantity lines, expands ~200 cashier abbreviations, and guesses brands
  including store brands (KRGR → Kroger, GV → Great Value). `POST /v1/scan/receipt`
  checks each item (`recalled` ≥ 0.65, `possible` ≥ 0.45, else `clear`), optionally
  creates de-duplicated watch items tagged `importedFrom: receipt`, and stores a
  `ReceiptScan` so the receipt can be re-checked later as new recalls arrive. Premium users
  may send the photo; `premium/receiptDecode.ts` asks Claude for clean product names when
  the dictionary falls short.

## AI providers (`ai/`)

`runStructured(userId, request)` is the one entry point for premium AI: prompt + zod schema
(+ images, web search, MCP). `ai/providers/*` implement Claude (SDK), OpenAI (Responses API),
Gemini (generateContent) and OpenAI-compatible chat endpoints over raw HTTP; `ai/schema.ts`
converts the zod schema to each dialect; `ai/index.ts` picks a provider by capability from
`AI_PROVIDER` + `AI_PROVIDER_FALLBACKS`, fails over on transport errors, and records usage.
See docs/PREMIUM.md for the capability matrix.

## Restaurant catalog, grades and maintenance (`inspections/`)

The restaurant catalog is a shared asset, not per-user data. `RestaurantProfile` holds the
research, the health grade (`currentGrade`, `currentScore`, `gradeScale`, `gradeSource`), the
venue's coordinates, and counters; `RestaurantInspection` keeps each inspection with its
violations; `RestaurantNotice` records per-user events (grade change, first grade). Users
search the catalog and link to an existing profile. Removing the item or deleting the account
only unlinks. A daily job (`inspections/maintenance.ts`) re-checks grades older than
`GRADE_REFRESH_DAYS` for tracked venues, refreshes stale research without charging anyone,
and prunes only never-used profiles. Grade sources are pluggable adapters (NYC DOHMH, Chicago
CDPH today) with an AI-research fallback for other jurisdictions.

## Notifications (`notifications/push.ts`, `prefs.ts`, `digest.ts`)

Expo push in chunks of 100, tickets stored on the alert, `DeviceNotRegistered` disables the
device, receipts checked 15 minutes later. Android channels: `recalls` and `critical-recalls`.

Before sending, `decidePush()` applies the user's preferences in this order:
1. below `pushMinSeverity` or in `mutedCategories` → never pushed (marked with a
   `skipped:` ticket so it is not retried; still in the inbox);
2. `digestMode` → held for the daily digest, except critical recalls;
3. quiet hours (local time via `timezone`, window may wrap midnight) → re-queued with a
   delay until the window ends, except critical recalls.

`sendDigests()` runs hourly from the worker and sends one summary push per user whose local
hour equals `digestHour`, covering every un-pushed, un-dismissed alert; at most once per 20h.
Dismissed alerts are never pushed.

## Alert lifecycle

`Alert` rows carry `readAt`, `dismissedAt` + `dismissReason` (`dont_have`, `false_match`,
`not_interested`) and `resolvedAt` + `resolvedAction` (`discarded`, `returned`,
`contacted`, `checked_not_affected`). The inbox hides dismissed alerts by default; the
`(userId, recallId)` uniqueness means a dismissed recall will not come back for that user.
`false_match` dismissals are the signal to tune matching heuristics against.

## Category subscriptions

`WatchItem.kind = category` with `categories[]` and `minSeverity` matches recalls by
category and severity instead of text, and only those distributed nationwide or in the user's
home / current state when a state is known. Scored 0.4–0.8 by severity so critical ones push.

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
