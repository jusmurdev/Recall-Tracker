# Recall Tracker: Android retest after the round-3 fixes (round 4)

Paste everything below this line into Claude Code on the desktop.

---

You are the **orchestrator**; OpenAI **Codex CLI** (`codex exec`) is your **worker**. The last
device run (Samsung SM-A166U, Android 16, 3-button nav) found receipt over-flagging, a false
"all clear" on offline cold start, odd device headlines and a few small issues. They are fixed on
branch **`feature/diet-profiles-and-fixes`**; use the latest commit on that branch. Confirm each fix on the
phone, re-check that nothing that passed before has regressed, and report with screenshots.
Do not change app code; list problems instead. Do not commit or push.

## Token discipline

- Codex does every long or noisy job: install, build, Gradle, curl batches, the phone tour, log
  reading. It writes full output to a file and ends with a summary of at most 30 lines.
- You read summaries and `tail -20`, never raw logs, never a file over 100 lines.
- You look at no more than 6 screenshots yourself; Codex describes the rest in one line each.

Worker call template (adapt flags if `codex exec --help` differs):

```bash
mkdir -p "$ROOT/.work"
codex exec --sandbox danger-full-access -C "$ROOT" \
  "TASK: <goal>. CONSTRAINTS: do not edit files under apps/ or packages/.
   OUTPUT: write everything to $ROOT/.work/<step>.md.
   FINISH: summary of at most 30 lines: done, passed, failed, exact error lines (max 5), next step." \
  > "$ROOT/.work/<step>.out" 2>&1; tail -40 "$ROOT/.work/<step>.out"
```

## Setup (reuse the previous checkout if it exists)

1. `cd` to the existing clone (or clone `https://github.com/jusmurdev/Recall-Tracker.git`), then
   `git fetch origin feature/diet-profiles-and-fixes && git checkout feature/diet-profiles-and-fixes && git pull`.
   Note the commit from `git log --oneline -1` for the report. Set `ROOT` to the repo root.
2. Postgres and Redis: the same user-local services as last time (no Docker on this machine).
   Databases `recall_tracker` and `recall_tracker_test`, user/password `recall`/`recall`.
3. Codex: `npm install`, `npm run build -w @recall/shared`, `npm run prisma:generate -w @recall/api`,
   then `npm run prisma:migrate -w @recall/api` against both databases (one new migration,
   `20261006060000_cleanup_junk_watch_items`, removes watch items labelled `scan` or a lone generic
   word such as `milk`; record how many of the phone user's watch items remain), `npm run ingest:once -w @recall/api` (falls back to
   `ingest:fixtures` on 403s), `DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo -w @recall/api`
   (expect `"dietAlerts": 9` or more).
4. You: start the API and worker in the background (`npm run dev:api`, `npm run dev:worker`, logs
   in `.work/`), then `curl -s localhost:4000/health`.
5. Codex: rebuild and install the dev build. Metro on **8082** (8081 is taken):
   `adb reverse tcp:4000 tcp:4000 && adb reverse tcp:8082 tcp:8082`, then in `apps/mobile`
   `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 RCT_METRO_PORT=8082 npx expo run:android --device --port 8082`.
   App code changed, so a fresh build is required.
6. Phone user: after first launch, make the phone's anonymous user premium with a full profile:

```sql
UPDATE "User"
SET tier = 'premium',
    "dietProfiles" = ARRAY['allergy_peanut','allergy_milk','gluten_free','halal','kosher','vegan'],
    "otherAllergens" = ARRAY['mustard']
WHERE "installId" LIKE 'android-%';
```

Then in the app toggle one allergy chip off and on (that triggers the alert backfill) and pull to
refresh Home.

Notes: dismiss the dev "Open debugger to view warnings" toast before tapping the tab bar. To
simulate offline, stop the API process (airplane mode does not cut `adb reverse`). Font size is
scriptable: `adb shell settings put system font_scale 1.3` (reset with `1.0`).

## Part A: API checks (Codex, one call, `.work/api.md`)

| # | Request | Pass when |
|---|---|---|
| A1 | `POST /v1/scan/match` `{"ocrText":"Zappo Crunch Bar"}` | `status` `clear`, `matches` empty (live FDA data has real "Crunch" recalls) |
| A2 | `POST /v1/scan/match` `{"ocrText":"Prairie Paws dog food"}` | exactly one match, the Prairie Paws recall, `status` `recalled` |
| A3 | `POST /v1/scan/match` `{"ocrText":"ZAPPO CRUNCH BAR\nINGREDIENTS: SUGAR, RICE, CASEIN, PORK GELATIN, MUSTARD FLOUR"}` as a user with milk, halal, kosher, vegan and mustard on | `matches` empty; `diet` has milk, halal, kosher, vegan and mustard lines |
| A4 | `POST /v1/scan/match` `{"ocrText":"MILK","watch":true}` | `status` `clear`, `watchItem` null (no watch item for a generic word) |
| A5 | `POST /v1/scan/match` `{"ocrText":"Jif Creamy Peanut Butter","watch":true}` | `watchItem.label` is `Jif Creamy Peanut Butter` (never `scan`) |
| A6 | `OPTIONS /v1/me/preferences` with `Origin: http://localhost:8080` and `Access-Control-Request-Method: PATCH`, then the same for PUT and DELETE | 204 and `access-control-allow-methods` contains the method |
| A7 | `PATCH /v1/me/preferences` `{"dietProfiles":["allergy_peanut"],"otherAllergens":[]}` then `{"dietProfiles":[],"otherAllergens":[]}` then `{"dietProfiles":["allergy_peanut"]}` | each response has `dietAlertsMatching`; the first and third are ≥ 1 and count only peanut alerts; the second is 0; `dietAlertsAdded` is 0 on the third |
| A8 | `GET /v1/recalls?q=tray`, `?q=insert`, `?q=kit`, `?q=catheter`, plus `?limit=50` | collect every `headline`: none starts with `Brand Name:` or `REF`, none contains a part number like `DYNJ59097A` or `5612-P-411`, none has an all-caps word of 4+ letters other than USDA/FDA/CPSC; list any offenders verbatim |
| A10 | `POST /v1/scan/receipt` `{"ocrText":"KROGER\nKRGR WHL MLK GAL 3.19\nGV CHKN NDL SP 1.29\nTOTAL 4.48"}` with live FDA data | soup line decodes to `great value chicken noodle soup`; both lines `clear` (or `possible` only against a recall that really names that store-brand product); never matched to the Liquid Handler, convenience kits, roast beef sandwich or eggs recalls |
| A11 | `POST /v1/scan/match` `{"ocrText":"great value"}`; receipt `PRAIRIE PAWS DOG FOOD 24.99` | first: no matches; second: `recalled` |
| A12 | `GET /v1/recalls?q=bard`, `?q=medrad`, `?q=convenience`, `?q=pericare`, `?q=dopamine`, `?q=acetabular` | headlines contain no `¿`, do not start with `1)` or `Products that contain`, `Inj` reads `Injection`, no repeated phrases like `acetabular insert … acetabular insert`; list any odd ones verbatim |
| A9 | Regression: UPC `087654321098`, `0087654321098`, `0 87654 32109 8`; `GET /v1/recalls?state=ZZ`; duplicate `POST /v1/watchlist` of `Skippy peanut butter`; bad JSON body | same results as last run: one `upc_exact` match each, 400 `validation`, second post `duplicate: true`, 400 `bad_json` |

## Part B: phone tour (Codex in agent mode; screenshots in `.work/shots/`, notes in `.work/tour.md`)

For every stop: screenshot, expected vs seen, PASS/FAIL. On every screenshot also check: nothing
under the system nav bar, every button bordered with even spacing, no clipped or mid-word-wrapped
text, US spelling.

### Fixed items

| # | Item | Steps | Pass when |
|---|---|---|---|
| B1 | Clipped inputs | `font_scale 1.0`: open You → Diet and allergies, Scan → Type it in (Product and Receipt), Browse search, Watch a brand, Track a restaurant | placeholders read "Other allergen", "Product name", "One item per line", "Search recalls", "Brand or product", "Restaurant name"; each on one line, not clipped top or bottom; examples appear as grey hint lines under the fields |
| B2 | Clipped inputs, large text | repeat B1 at `font_scale 1.3` and at the largest (`1.6` or the phone's max, `adb shell settings put system font_scale 1.6`) | no clipping; at large sizes the Add button stays inside the card, beside the field or wrapped below it (either is fine); the receipt box is a tall multi-line box with text starting at the top; the Product/Receipt switch fits on screen; tab labels are fully readable (they may shrink, but no "Ho…"); reset to `1.0` after |
| B3 | Typed allergen | You → tap "Other allergen", type `lupin`, tap Add | the field and Add button stay visible above the keyboard while typing; `lupin` appears as a removable chip; the field does not grow to two lines |
| B4 | Home diet lead | You → turn every chip and switch off and remove typed allergens; open Home | no "N recalls match your …" lead; the Alerts tab still lists the old diet alerts |
| B5 | Match note | You → tap Peanuts on | within a second a note appears directly under the card's intro text, readable without scrolling: "N recent recall(s) match(es) your profile. See the Alerts tab." with an Open button (or "No current recall matches your profile…"); N counts only peanut matches; Open goes to Alerts. Turn the full profile back on afterwards |
| B6 | Lone-word match | Scan → Product → type `Zappo Crunch Bar` → Check it | "Looks fine" with no recall rows |
| B7 | Diet heads-up | Scan → type `Mustard pretzels` → Check it | "Looks fine" plus a "Heads up for your diet" card with a mustard-allergy line |
| B8 | Watch toggle | Scan → Type it in | "Keep an eye on this for me" is **off** by default; switch it on, check `MILK`; Watchlist gains no `milk` or `scan` item |
| B9 | Premium upsell | as the premium user: Scan → Receipt → type `KRGR WHL MLK GAL 3.19` / `GV CHKN NDL SP 1.29` → Check it; then Home → "Eating out?" map | no "Premium reads the photo with AI" tip on the receipt; the map header has no "Tracking is Premium" line; only one empty state if there are no places |
| B10 | Recall footer | open any recall detail, do not scroll; then scroll to the bottom | at scroll top nothing sits under the nav buttons; at the bottom "I have this" and "Share" are fully above the nav bar and tappable |
| B11 | Device headlines | Browse → search `tray`, `insert`, `kit` | headlines read like product names; list any with catalog numbers, `Brand Name:` or all-caps words |
| B12 | Cold start, release build | in `apps/mobile`: `RECALL_QA_CLEARTEXT=1 npx expo prebuild -p android --clean`, then `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo run:android --variant release --device` (release builds block plain HTTP unless this QA flag is set at prebuild). Open once online and wait 40 s, stop the API, relaunch twice; then clear app data (`adb shell pm clear dev.jusmur.recalltracker`), relaunch with the API still stopped | relaunches 1 and 2 both show cached rows with "Showing what we saved earlier"; after clearing data Home shows "We can't check right now" with Try again and never "You're all clear"; record splash and first-content times; restart the API afterwards |
| B13 | Receipt on the phone | Scan → Receipt → type `KRGR WHL MLK GAL 3.19` / `GV CHKN NDL SP 1.29` → Check it, with "Keep an eye on all of these" off, then again with it on | first run: both lines Fine, no "watching" text in the header; second: header says "watching all 2" (store brand plus product counts as watchable); then `BNNA ORG 1.29` alone with the toggle on: no "watching" text, because a generic-only line is never watched |
| B14 | Watching list | Home → Watching | no item labelled `scan` or `milk`; each row has a working remove action |

### Regression sweep (previously passing; one screenshot each)

| # | Check | Pass when |
|---|---|---|
| R1 | Tab bar and bottom buttons on Alert detail and Track a restaurant | above the nav bar |
| R2 | Map without a Maps key | no crash; note plus list |
| R3 | You → Notifications | push-unavailable notice names the phone's time zone |
| R4 | Typed `Prairie Paws dog food` and `MILK` | recalled / Looks fine |
| R5 | Offline (stop the API): Browse, Scan, Home | "Can't reach the server" with Retry; Home cached with the offline notice that clears on Retry after restarting the API |
| R6 | Peanut diet alert detail | "Peanut allergy" card, highlighted phrase, About diet alerts button |
| R7 | Browse "For my diet" chip | narrows the list with a reason per row; off restores the full list |
| R8 | Barcode on recall detail and the paywall text | 12-digit UPC; "Billed through Google Play" (check as a free user or skip) |

## Part C: tests (Codex)

`npm run typecheck`, `TEST_DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_test npm test -w @recall/api`,
`npm test -w @recall/mobile`. Expect **123** API and **12** mobile tests passing.

Optional, if Chromium and Playwright are available: export the web build
(`cd apps/mobile && EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo export --platform web --output-dir dist`),
serve it (`node scripts/serve-web-export.mjs dist`, port 8080), and run
`node scripts/screenshots-inputs.mjs ../../.work/inputs`. It should print "all inputs fit at 1.0x,
1.3x and 1.6x". The script imports Playwright from `/opt/node-tools/...`; change that import to
`playwright` if needed.

## Part D: report (you)

Write `$ROOT/RETEST_REPORT.md`:

1. Environment: device model and Android version, branch commit, data source (live or fixtures),
   dev or release build per section.
2. Table: A1–A12, B1–B14, R1–R8, tests. PASS/FAIL, screenshot, one-line note.
3. Still broken: steps, expected, actual, screenshot, your guess at the file.
4. New problems: anything this round introduced.
5. Codex vs Claude call split.

Show me the report and attach the B12 "can't check" screenshot, B12 cached relaunch, B13, and B6.

## Rules

- No commits, no pushes, no edits under `apps/` or `packages/`.
- API keys only in `apps/api/.env`.
- Reset `font_scale` to `1.0` and restart the API before you finish.
- If a Codex call is silent for 25 minutes, kill it, read the last 20 lines, relaunch narrower.
- If only I can unblock you (phone locked, a permission dialog, SDK path), say exactly what in one sentence.
