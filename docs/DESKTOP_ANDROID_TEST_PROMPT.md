# Recall Tracker: local stack + Android device test run (Claude Code + Codex)

Paste everything below this line into Claude Code on the desktop.

---

You are the **orchestrator**. OpenAI **Codex CLI** (`codex exec`) is your **worker**. Your job is to
get the Recall Tracker app running against a database hosted on this computer, exercise it on the
Android phone connected over `adb`, and hand me a test report with screenshots.

## Token discipline (read first)

My Claude budget is the scarce resource. Codex is cheap. So:

1. **Delegate every long or verbose task to Codex**: cloning, `npm install`, builds, Gradle, log
   reading, test runs, UI tours, screenshot review. You plan, verify, and decide.
2. **Never read raw logs or build output yourself.** Make Codex write full output to a file and
   return a summary of at most 30 lines. You only read the summary and, when needed, `tail -20`.
3. **Never `cat` a file over 100 lines.** Use `grep`, `sed -n`, `head`, `tail`, or ask Codex.
4. **Look at at most 4 screenshots yourself** (Home, one Scan result, Alert detail, Map). Codex
   reviews the rest and describes each in one sentence.
5. Keep your own messages short. No narration between tool calls.

### How to call Codex

Make sure it is installed and signed in once:

```bash
codex --version || npm i -g @openai/codex
codex login status || codex login
```

Standard worker call. Always set the working directory, always redirect output to a file, always
ask for a short summary at the end:

```bash
mkdir -p "$ROOT/.work"
codex exec --full-auto -C "$ROOT" \
  "TASK: <what to do>.
   CONSTRAINTS: <what not to touch>.
   OUTPUT: write everything you learn to $ROOT/.work/<step>.md.
   FINISH: print a summary of at most 30 lines: what you did, what passed, what failed, exact
   error lines (max 5), and what you recommend next." \
  > "$ROOT/.work/<step>.out" 2>&1
tail -40 "$ROOT/.work/<step>.out"
```

`--full-auto` keeps Codex inside the repo folder. Steps that need Docker, `adb`, or the Android SDK
reach outside the repo; if such a step fails with a sandbox or permission error, re-run that one
call with `--sandbox danger-full-access` (this is my own machine, I authorize it). If your Codex
version rejects a flag, run `codex exec --help` and adapt. Use a long-running Codex call for one
whole phase rather than many small calls.

Also use Codex as an **agent** for open-ended work: "find out why X fails and fix it", "tour the
app and screenshot every screen". Give it the goal, the constraints, and the output file.
Review its diff with `git diff --stat` before accepting changes.

## Facts about this project (so you do not have to discover them)

- Repo: `https://github.com/jusmurdev/Recall-Tracker`. The code is on branch **`private/app`**.
  `main` is a README-only landing page; do not use it.
- npm workspaces monorepo, Node 20+: `packages/shared` (zod types), `apps/api` (Fastify + Prisma +
  PostgreSQL 16 + BullMQ/Redis), `apps/mobile` (Expo SDK 57, expo-router, react-native-maps,
  a custom native OCR module in `apps/mobile/modules/vision-ocr` using ML Kit on Android).
- Because of the native module and maps, **Expo Go will not work**. The Android app must be a
  development build: `npx expo run:android --device` (needs Android SDK, `ANDROID_HOME`, JDK 17).
- `docker-compose.yml` has `postgres` (user/pass/db `recall`/`recall`/`recall_tracker`, port 5432)
  and `redis` (6379). Only start those two; run the API from source with `tsx` for fast iteration.
- `apps/api/.env.example` documents every variable. Required: `DATABASE_URL`, and
  `CONNECTOR_ENCRYPTION_KEY` must be 64 hex chars if set (`openssl rand -hex 32`). AI keys are
  optional; without them premium AI features return a clear "provider not configured" error,
  which is acceptable for this run.
- Ingestion: `npm run ingest:once -w @recall/api` pulls live FDA/USDA/CPSC data. If the network
  blocks it, `npm run ingest:fixtures -w @recall/api` loads recorded fixtures. Then
  `DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo -w @recall/api` seeds a premium demo
  user, watch items, restaurants with health grades, and alerts.
- API tests need a second database: create `recall_tracker_test` and run with
  `TEST_DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_test`.
- The phone reaches the API through `adb reverse`. The mobile config rewrites any URL containing
  the string `localhost` to `10.0.2.2` (emulator alias), which breaks on a real phone. So use
  **`EXPO_PUBLIC_API_URL=http://127.0.0.1:4000`** together with `adb reverse tcp:4000 tcp:4000`.
  Metro needs `adb reverse tcp:8081 tcp:8081` (`expo run:android` usually does this itself).
- The app signs in anonymously on first launch (free tier). To test premium screens on the phone,
  flip that user in the database:
  `UPDATE "User" SET tier='premium' WHERE "installId" LIKE 'android-%';` then pull to refresh.
- The restaurant map uses Google Maps on Android and needs a key in `apps/mobile/app.json` at
  `android.config.googleMaps.apiKey`. If I have not given you one, the map tiles will be blank
  but the list, pins' data, and ratings still load. Note it in the report, do not treat it as a
  bug.
- Screenshots from the phone: `adb exec-out screencap -p > shots/NN-name.png`. Drive the UI with
  `adb shell input tap X Y`, `adb shell input text '...'`, `adb shell input keyevent 4` (back),
  and find coordinates with `adb shell uiautomator dump /sdcard/ui.xml && adb pull /sdcard/ui.xml`.
- Known environment quirks: `prisma migrate reset` may be refused by tooling; use
  `prisma migrate deploy` on a fresh database instead. Start Postgres and Redis before anything.

## Phases

Run phases in order. Each phase is one Codex call unless noted. Stop and tell me only if a phase
is blocked by something only I can supply (SDK path, Maps key, phone unlock, a login prompt).

### Phase 0: Preflight (you, directly, short commands)

```bash
node -v; docker --version; adb devices -l; echo "$ANDROID_HOME"; java -version 2>&1 | head -1; codex --version
```

Exactly one Android device must show as `device` (not `unauthorized`, not `offline`). If not,
tell me what to tap on the phone and stop.

### Phase 1: Clone and install (Codex)

```
Clone https://github.com/jusmurdev/Recall-Tracker.git into ./recall-tracker, check out branch
private/app, run `npm install`, then `npm run build -w @recall/shared` and `npm run typecheck`.
Do not change any source. Record Node/npm versions and any warnings worth knowing.
```

Set `ROOT=$PWD/recall-tracker` for all later calls.

### Phase 2: Database on this computer (Codex, may need danger-full-access for Docker)

```
In $ROOT: `docker compose up -d postgres redis` and wait for both to be healthy. Copy
apps/api/.env.example to apps/api/.env; set CONNECTOR_ENCRYPTION_KEY to `openssl rand -hex 32`;
leave AI keys empty unless they exist in the environment. Run `npm run prisma:generate -w
@recall/api` and `npm run prisma:migrate -w @recall/api`. Create database recall_tracker_test
(`docker compose exec postgres createdb -U recall recall_tracker_test`). Try `npm run ingest:once
-w @recall/api`; if it fails on network, run `npm run ingest:fixtures -w @recall/api` and say so.
Then `DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo -w @recall/api`. Report row counts:
`SELECT count(*) FROM "Recall"; SELECT count(*) FROM "RestaurantProfile";`
```

### Phase 3: API up (you, two background processes)

```bash
cd "$ROOT" && (npm run dev:api > .work/api.log 2>&1 &) && (npm run dev:worker > .work/worker.log 2>&1 &)
sleep 8; curl -s localhost:4000/health; curl -s 'localhost:4000/v1/recalls?limit=1' | head -c 300
```

If health fails, hand `.work/api.log` to Codex to diagnose and fix; do not read it yourself.

### Phase 4: Android build and install (Codex, long, danger-full-access)

```
In $ROOT/apps/mobile: run `adb reverse tcp:4000 tcp:4000` and `adb reverse tcp:8081 tcp:8081`.
Then `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo run:android --device` (pick the only
connected device if prompted). This runs prebuild and Gradle; it can take 10-20 minutes the first
time. If Gradle fails, fix the environment (SDK packages, JDK 17, licenses) rather than the app
code; if a fix to app code is unavoidable, keep it minimal and list the exact diff in your summary.
Confirm with `adb shell pidof dev.jusmur.recalltracker` that the app is running. Keep the Metro
dev server running in the background and write its log to $ROOT/.work/metro.log.
```

### Phase 5: API test suite (Codex, in parallel with Phase 4 if you can)

```
In $ROOT run `TEST_DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_test
npm test -w @recall/api` and `npm test -w @recall/mobile`. Report pass/fail counts per file and
the first 5 lines of any failure. Do not modify tests.
```

### Phase 6: Guided tour on the phone with screenshots (Codex, agent mode)

Create `$ROOT/.work/shots/`. Codex drives the app with `adb shell input` and `uiautomator dump`,
takes a screenshot after each step, and writes `$ROOT/.work/tour.md` with one line per screen:
what it expected, what it saw, PASS/FAIL. Grant permissions on the phone when prompted (location
"while using", camera, notifications). Required stops, in order:

| # | Screen / action | What to verify |
|---|---|---|
| 01 | Home after first launch | Headline ("You're all clear" or "N things need a look"), no raw error text |
| 02 | Browse tab | Recall list loads; severity labels read Serious / Moderate / Minor |
| 03 | Browse search for a word that appears in the list | Results narrow; clearing restores the list |
| 04 | Browse "Near me" pill | Location prompt appears once; pill shows the state after allowing |
| 05 | Open a recall | Plain-English headline, "What to do" steps, "Show details" disclosure works |
| 06 | Watchlist tab, add a brand from the recall list | Item appears; an alert is created within ~10 s |
| 07 | Alerts tab | New alert visible with emoji + reason |
| 08 | Alert detail | Buttons "I handled it", "I don't have this", "This isn't my product" stacked, with borders and even spacing; dismiss works |
| 09 | Scan tab | Two clear choices (product vs receipt); camera opens |
| 10 | Scan a real product label or barcode | A verdict card appears (match or "nothing found"); no crash. OCR runs on device, so note the latency |
| 11 | Scan a real receipt | Line items are listed; each has a verdict; "wrong item" affordance exists |
| 12 | Settings tab | Notification preferences, quiet hours, "Use my location" all respond |
| 13 | Make the user premium (SQL above), pull to refresh Home | Premium entry points appear |
| 14 | Watch a restaurant: search "Capitol Deli" | Catalog hit appears with health grade |
| 15 | Restaurant detail | Grade, inspections, supplier section (may say research unavailable without AI keys) |
| 16 | Map | Pins or list near the phone's location with star ratings; blank tiles acceptable without a Maps key |
| 17 | Kill and relaunch the app | Lists render immediately from cache before the network answers |

On every screenshot Codex also checks the UI quality points I care about and lists violations:
buttons touching each other, buttons with no visible border, text cut off or wrapping mid-word,
inconsistent capitalization, placeholder or lorem text, British spellings.

### Phase 7: Report (you, from Codex's files)

Write `$ROOT/TEST_REPORT.md` with:

1. Environment: OS, Node, device model and Android version (`adb shell getprop ro.product.model
   ro.build.version.release`), data source used (live or fixtures), whether a Maps key was set.
2. Results table: the 17 stops above, PASS/FAIL, screenshot filename, one-line note.
3. API and mobile test counts.
4. Bugs found, each with: screen, steps, expected, actual, screenshot, your guess at the file to
   fix. Do **not** fix bugs in app code during this run unless they block the tour; list them.
5. Codex usage: roughly how many Codex calls you made and what you handled yourself.

Then show me the report and attach `.work/shots/01-home.png`, the scan result, the alert detail,
and the map. Do not commit or push anything.

## Rules

- Do not push to GitHub. Do not change `main`.
- Do not store my API keys anywhere except `apps/api/.env`, which is gitignored.
- If a Codex call runs more than 25 minutes with no output, kill it, read the last 20 lines of its
  output file, and relaunch it with a narrower task.
- If something blocks you and only I can resolve it, say exactly what you need in one sentence.
