# Recall Tracker

A US recall tracker: one shared ingestion service pulls every recall from public government
sources into a single database, and a mobile app alerts people about the things they actually
buy, plan to buy, eat out on, or hold in their hand.

The premise: US food-safety enforcement is reactive and under-resourced, and recall notices
are scattered across agency websites that nobody reads. This app closes the loop between
"a recall was published" and "the person who has that jar in their pantry finds out".

## What's here

```
apps/api        Fastify + Prisma + BullMQ backend: ingestion, matching, push, premium AI
apps/mobile     Expo (React Native) app: feed, scan (barcode + OCR), watchlist, alerts, premium
packages/shared Zod schemas + TypeScript types shared by both
docs/           Architecture, data sources, premium feature design
```

### Data sources (free tier, all public)

| Source | Covers | API |
| --- | --- | --- |
| **FDA** openFDA enforcement reports | Food, dietary supplements, cosmetics, pet food, drugs, devices | `api.fda.gov/{food,drug,device}/enforcement.json` |
| **USDA FSIS** | Meat, poultry, egg products + public health alerts | `fsis.usda.gov/fsis/api/recall/v/1` |
| **CPSC** | Consumer products (kitchenware, bottles, appliances, toys) | `saferproducts.gov/RestWebServices/Recall` |

Clients never call these APIs. The worker polls each source a few times a day on a cron,
normalises the records into one `Recall` schema (severity, category, UPCs, distribution
states, brands), de-duplicates by content hash, and stores them in Postgres. The app reads the
shared database through the API. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

### Features

**Free**
- Browse and search every recall (full-text, by category, severity, state).
- Watch products by brand/keyword or barcode. Instant check against the last 6 months of
  recalls; push notification when a new matching recall arrives.
- Scan a product: barcode via the camera, or snap the label and on-device OCR reads it (Apple
  Vision on iPhone using the Neural Engine, ML Kit on Android). One tap, instant verdict.
  Only text leaves the phone.
- Scan a receipt: snap it, every line is decoded from cashier shorthand ("KRGR CRMY PNT BTR
  16Z" → Kroger creamy peanut butter), checked against recalls, and can be watched in one
  tap. Receipts are saved and re-checked against new recalls whenever reopened.
- Alert inbox with "why you got this" explanations and confidence.
- Dietary profile: allergies (the big nine plus your own), gluten-free, halal, kosher and vegan. Alerts
  when a recall mentions what you avoid, a heads-up on scanned labels and receipts, a "For my
  diet" filter. Deterministic and free; honest about limits (`docs/diet-profiles.md`).
- Location-aware ranking: the phone resolves its state on-device and sends only that, so
  recalls sold where you live or currently are rank higher and the feed has a "Near me" filter.
- Category subscriptions: "every Class I food recall sold in my state" with no product list.
- "Check your package" lot/date/model codes and "What to do" remedy text on every recall.
- Alert actions: I handled it (threw away / returned / contacted / checked, not affected),
  I don't have this, wrong match. Dismissed alerts never push.
- Notification preferences: minimum severity, muted categories, quiet hours (in your time
  zone), daily digest at a chosen hour. Critical recalls always push immediately.
- Share any recall, app-icon badge with unread count, offline cache of the last feed,
  watchlist and alerts, and one-tap "Delete my data".

**Premium**
- **Connected accounts (MCP).** Users connect grocery / delivery / shopping accounts that
  expose a remote MCP server. Claude reads purchase history through the Messages API MCP
  connector and turns it into watch items. The server never parses retailer formats.
- **Restaurant tracking.** Claude with server-side web search researches who supplies a
  restaurant's kitchen and recent food-safety signals; supplier names become watch terms, so
  a Boar's Head recall alerts everyone tracking a deli that serves it. Research is stored
  once per restaurant and shared by every user who tracks it, so it runs once rather than
  per person and is refreshed only when stale.
- **AI label identification.** When OCR fails (curved bottles, glare), the photo is identified
  by Claude vision and matched.
- **AI receipt decoding.** The receipt photo is read and lines the dictionary could not
  expand are decoded, so even cryptic store abbreviations resolve to real products.
- **Bring your own model.** Premium AI runs on Claude, OpenAI, Google Gemini, or any
  OpenAI-compatible endpoint (Ollama, Groq, Together…), chosen per feature by capability with
  automatic fallback. See [docs/PREMIUM.md](docs/PREMIUM.md#ai-providers).
- **Restaurant map (free).** A map of restaurants around you with a 1–5 safety rating from
  the health grade and recall exposure, fed by the shared catalog plus the local health
  department's open data where we have an adapter. Tap a pin for grade, inspection history and
  recalls touching the kitchen; tracking from there is Premium.
- **Health grades.** Official inspection grades and violation history from health-department
  open data (NYC and Chicago adapters; AI research elsewhere), refreshed weekly and shared.
  Trackers are notified when a grade drops.
- **Shared restaurant catalog.** Every restaurant anyone adds is kept with its research and
  grade; others pick it from search and get results instantly. Nothing is lost when a user
  removes it.
- **Arrival alerts.** Tracked restaurants are pinned to coordinates; iOS/Android geofences
  give a heads-up when you walk into one whose suppliers have an active recall, and a "near
  me" lookup shows restaurants other users already track around you.

See [docs/PREMIUM.md](docs/PREMIUM.md).

## Screenshots

<p>
  <img src="docs/screenshots/01-home.png" width="180" alt="Home" />
  <img src="docs/screenshots/02-recall-detail.png" width="180" alt="Recall detail" />
  <img src="docs/screenshots/07-restaurant-detail.png" width="180" alt="Restaurant with health grade" />
  <img src="docs/screenshots/10-alert-detail.png" width="180" alt="Alert detail" />
</p>

All screens, and how to regenerate them: [docs/screenshots](docs/screenshots/README.md).

## Quick start

```bash
# 1. Infra
docker compose up -d postgres redis

# 2. Install + database
npm install
cp apps/api/.env.example apps/api/.env          # fill in keys as needed
npm run build -w @recall/shared
npm run prisma:migrate -w @recall/api

# 3. Load data (live APIs, or recorded fixtures when offline)
npm run ingest:once -w @recall/api
npm run ingest:fixtures -w @recall/api

# 4. Run
npm run dev:api        # http://localhost:4000  (GET /health, /v1/recalls)
npm run dev:worker     # scheduled ingestion + push + research jobs
npm run dev:mobile     # Expo dev server
```

Environment variables are documented in `apps/api/.env.example`. The whole stack also runs
with `docker compose up` (api, worker, postgres, redis).

### Design principles

- **Lead with the answer.** Home opens with "You're all clear" or "3 things need a look".
- **Plain words.** "Serious / Moderate / Minor" instead of Class I/II/III; "Salmonella
  contamination risk" instead of the agency's sentence; "Matches the brand of your Jif".
- **Calm by default.** Source ids, distribution lists and full descriptions sit behind
  "Show details"; settings keep rarely-used options under "More options".
- **One accent, colour for status.** Warm off-white background, teal for actions, red /
  amber / blue only to say how worried to be.

### Mobile (iPhone first)

The app is an Expo Router project configured for iOS builds out of the box: bundle id,
Info.plist purpose strings for camera, location (when-in-use and always) and photos,
background modes for remote notifications and location, push entitlement, encryption
export declaration, placeholder icons, and EAS build profiles in `apps/mobile/eas.json`.

```bash
cd apps/mobile
npx expo prebuild                       # generates ios/ and android/
npx expo run:ios                        # local simulator build (needs Xcode)
eas build --profile device --platform ios   # development build on a real iPhone
eas build --profile production --platform ios && eas submit -p ios
```

Barcode scanning works in Expo Go, but OCR, geofencing and push tokens need a development
build. OCR is a local Expo module in `apps/mobile/modules/vision-ocr` (Apple Vision on iOS,
ML Kit on Android) that returns positioned lines so receipts are rebuilt into rows on-device. Before shipping, replace the generated `assets/*.png` with real artwork,
set `extra.eas.projectId`, `updates.url` and the `submit.production.ios` fields.

Release builds block plain HTTP. For QA against a local API over `adb reverse`, opt in at
prebuild time only; production builds never get it:

```bash
RECALL_QA_CLEARTEXT=1 npx expo prebuild -p android --clean
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo run:android --variant release --device
```

Set the API URL with `EXPO_PUBLIC_API_URL=https://your-api` or `extra.apiBaseUrl` in
`app.json`. Push notifications go through Expo's push service; add your EAS `projectId`
and (optionally) `EXPO_ACCESS_TOKEN` on the server.

## Tests

```bash
npm test -w @recall/api     # unit + integration (needs Postgres at TEST_DATABASE_URL)
npm run typecheck           # all workspaces
```

Integration tests ingest the recorded fixtures into a real Postgres database and exercise
matching, alerts and every HTTP route. No network access is needed.

## Design notes

- **Matching** runs in Postgres: exact UPC, case/punctuation-insensitive term match, and
  `pg_trgm` word similarity for fuzzy brands ("boars head" finds "Boar's Head"). Scores
  combine match type, term coverage, severity and whether the recall was distributed in the
  user's state. Alerts below 0.5 are kept in the inbox but not pushed.
- **Idempotent ingestion**: each run re-fetches a 3-day overlap window, hashes the normalised
  record, and only re-alerts on new recalls or escalations (severity up, re-opened).
- **Privacy**: OCR runs on-device; only extracted text is sent. Location is reverse-geocoded
  on-device and only the two-letter state reaches the server; restaurant coordinates are
  stored (they are public places) but user coordinates never are, and geofence checks run on
  the phone. Connector tokens are encrypted at rest (AES-256-GCM). Anonymous device auth; no
  email required.
- **Cost control**: per-user daily AI quota, token accounting per feature, low effort for
  simple vision calls.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and roadmap.
