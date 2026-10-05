# Recall Tracker: home widgets, QA release build, live receipt and free paywall (round 5)

Paste everything below this line into Claude Code on the desktop.

---

You are the **orchestrator**; OpenAI **Codex CLI** (`codex exec`) is your **worker**. Test on the
Samsung SM-A166U (Android 16, 3-button navigation) over `adb`. Branch
**`feature/diet-profiles-and-fixes`**, latest commit. This round covers four things:

1. **New Android home screen widgets**: "Recall status" and "Quick scan".
2. **The QA release build**: plain HTTP is allowed only for QA, the release app runs without Metro,
   and offline cold starts are honest.
3. **The receipt matching fix against live FDA data**: last round used stand-in recalls.
4. **The free-user paywall text**: not rechecked since round 2.

Do not change app code; report problems. Do not commit or push.

## Token discipline

- Codex does every long or noisy job: install, prebuild, Gradle, curl batches, SQL, the phone
  steps and log reading. It writes full output to a file and ends with at most 30 lines of summary.
- You read summaries and `tail -20` only, never a file over 100 lines, and at most 8 screenshots
  yourself; Codex describes the rest in one line each.

```bash
mkdir -p "$ROOT/.work"
codex exec --sandbox danger-full-access -C "$ROOT" \
  "TASK: <goal>. CONSTRAINTS: do not edit files under apps/ or packages/.
   OUTPUT: write everything to $ROOT/.work/<step>.md.
   FINISH: summary of at most 30 lines: done, passed, failed, exact error lines (max 5), next step." \
  > "$ROOT/.work/<step>.out" 2>&1; tail -40 "$ROOT/.work/<step>.out"
```

## What the widgets should do (the spec you are testing)

**Recall status** (default 4x2, resizable from about 3x2 up to 5x4):
- Leads with one of: "N things need a look", "N recalls match your diet profile", "You're all clear",
  "Nothing watched yet", "Not checked recently", or "Open Recall Tracker" when the app has never
  run. It **never** says "You're all clear" without data, or from data older than 48 hours.
- It **never names the diet or allergy** that matched (a home screen is visible to anyone). Rows
  show the product and a severity word (Serious, Moderate, Minor, Unrated) only.
- Up to three alert rows, each opens that alert. Tapping the background opens the Alerts tab
  when something needs a look, the "Watch a brand" screen when nothing is watched yet, and
  Home otherwise. Below about 250 dp wide the rows are hidden.
- Footer: "Checked just now / N min ago / N h ago / yesterday / N days ago", plus
  "Couldn't refresh · " when a refresh failed. A bordered "↻ Refresh" button shows "Checking…"
  while it works.
- Updates: instantly whenever the app loads alerts; on add; on Refresh; and on Android's periodic
  update (every 30 min at most) but only refetches when the saved data is over 6 hours old. The
  widget never creates an account; before the first app launch it says "Open Recall Tracker".
- Deleting the account in the app resets the widget to "Open Recall Tracker".

**Quick scan** (4x1, resizable horizontally): two bordered buttons, "Scan a product" (filled
teal) and "Check a receipt" (outlined). Each opens the Scan tab with that target selected.

iOS widgets are not part of this build.

## Setup

1. Repo: `git fetch origin feature/diet-profiles-and-fixes && git checkout feature/diet-profiles-and-fixes && git pull`;
   record `git log --oneline -1`. Set `ROOT`. Run `npm install` (a new native dependency,
   `react-native-android-widget`, was added).
2. Database (user-local Postgres and Redis, no Docker): `npm run build -w @recall/shared`,
   `npm run prisma:generate -w @recall/api`, `npm run prisma:migrate -w @recall/api` on
   `recall_tracker` and `recall_tracker_test` (nothing new since round 4).
3. **Live data**: `npm run ingest:once -w @recall/api`. FDA should load live; FSIS may 403 (then run
   `npm run ingest:fixtures -w @recall/api` for FSIS and CPSC only if they are empty). Record the
   recall count per source (`SELECT source, count(*) FROM "Recall" GROUP BY 1`). Then
   `DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo -w @recall/api`.
4. Start the API and worker in the background; `curl -s localhost:4000/health`.
5. **QA release build** (one build for everything below; the native widget module and manifest
   change require a fresh prebuild):

```bash
cd "$ROOT/apps/mobile"
adb reverse tcp:4000 tcp:4000
RECALL_QA_CLEARTEXT=1 npx expo prebuild -p android --clean
grep -n "usesCleartextTraffic" android/app/src/main/AndroidManifest.xml      # must be present
grep -n "widget.RecallStatus\|widget.QuickScan" android/app/src/main/AndroidManifest.xml   # both receivers
adb uninstall dev.jusmur.recalltracker || true                               # start as a brand-new free user
EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo run:android --variant release --device
```

   Do **not** open the app yet after install; part D1 needs a widget placed first.

Notes: release builds need no Metro and show no dev toast. To simulate offline, stop the API
process (airplane mode does not cut `adb reverse`). Font size: `adb shell settings put system font_scale 1.3`
(reset with `1.0`). Dark mode: `adb shell cmd uimode night yes` (reset with `no`). Widgets can be
listed with `adb shell dumpsys appwidget | grep -A3 recalltracker`, and a widget update can be
forced with `adb shell am broadcast -a android.appwidget.action.APPWIDGET_UPDATE -n dev.jusmur.recalltracker/.widget.RecallStatus --eia appWidgetIds <id>`.
Placing widgets needs the home screen UI: long-press an empty spot → Widgets → Recall Tracker.

## Part A: QA release build

| # | Check | Pass when |
|---|---|---|
| A1 | Cleartext only for QA | after the prebuild above, the manifest has `android:usesCleartextTraffic="true"`; then run `cd apps/mobile && npx expo config --type introspect --json` **without** `RECALL_QA_CLEARTEXT` and confirm the application element has no `usesCleartextTraffic` (production builds unaffected). Do not prebuild again without the flag |
| A2 | It is a release build | `adb shell dumpsys package dev.jusmur.recalltracker \| grep -i "flags="` shows no `DEBUGGABLE`; the app opens with Metro stopped; no "Open debugger" toast |
| A3 | Reaches the local API | after first launch, Home and Browse load data (proves plain HTTP to `127.0.0.1:4000` works in this build) |
| A4 | Offline cold start, cached: with data loaded, wait 40 s, stop the API, force-stop and relaunch twice | both relaunches show cached rows and "Showing what we saved earlier"; record splash end and first content time (`adb logcat -d -s ActivityTaskManager:I \| grep Displayed`) |
| A5 | Offline cold start, nothing cached: API still stopped, `adb shell pm clear dev.jusmur.recalltracker`, launch | Home shows "We can't check right now" with Try again, never "You're all clear"; restart the API, tap Try again: data loads |

A5 clears data, so it signs the app in as a new user on the next online launch. That is intended;
part B needs a free user.

## Part B: free-user paywall text (fresh free user after A5)

| # | Check | Pass when |
|---|---|---|
| B1 | User is free | `SELECT "installId", tier FROM "User" ORDER BY "createdAt" DESC LIMIT 1;` shows `free` for the newest `android-%` install |
| B2 | Paywall | You → "Try Premium" (or Home's premium card) opens the Premium screen; under "Start Premium" it reads exactly "Billed through Google Play. Cancel any time." (not "App Store"); the button is bordered, not clipped, and sits above the nav bar |
| B3 | Gated features say so | Track a restaurant → goes to the Premium screen; map header shows "Health grades are public data. Tracking is Premium." (unless it shows "Grades from …" for a covered city); a typed receipt whose only line is a short code (`TKZ 1.99`) shows the "Premium reads the photo with AI" tip (it appears only when a line could not be decoded into words longer than four letters). All three are correct for a free user |
| B4 | Free features work | Browse, a typed product scan, a typed receipt, and adding a watch item all work without hitting the paywall |

Then make this phone user premium with a diet profile for parts C and D:

```sql
UPDATE "User"
SET tier = 'premium',
    "dietProfiles" = ARRAY['allergy_peanut','allergy_milk','gluten_free','halal','kosher','vegan'],
    "otherAllergens" = ARRAY['mustard']
WHERE "installId" = (SELECT "installId" FROM "User" WHERE "installId" LIKE 'android-%' ORDER BY "createdAt" DESC LIMIT 1);
```

In the app, toggle one allergy chip off and on (triggers the alert backfill) and pull to refresh Home.

## Part C: receipt matching against live FDA data (API, Codex; use the demo token)

Run each receipt through `POST /v1/scan/receipt` with `Authorization: Bearer demo-token-for-screenshots`.
For every line record: product, status, and for each match the recall `sourceId`, `title`, `score`
and `explanation`. **Then judge each non-clear line by reading the recall title**: is it plausibly
the same product? Record `correct`, `wrong (unrelated)` or `unsure`.

| # | Receipt (one line per `\n`) | Pass when |
|---|---|---|
| C1 | `KROGER\nKRGR WHL MLK GAL 3.19\nGV CHKN NDL SP 1.29\nTOTAL 4.48` | soup decodes to `great value chicken noodle soup`; no match to device recalls (liquid handlers, convenience kits), sandwiches or eggs; anything non-clear names that store-brand product |
| C2 | `WALMART\nGV WHL MLK 3.48\nGV LG EGGS 18CT 4.12\nEQUATE IBUPROFEN 200MG 4.97\nGV SHRD MOZZ 2.97\nTOTAL 15.54` | no line `recalled` against an unrelated recall; store names in a recall's distribution list (sold at Walmart) never count |
| C3 | `COSTCO\nKS ORG ALMD BTR 9.99\nKS PAPER TOWELS 22.99\nKS FRZN BLUEBRY 12.49\nTOTAL 45.47` | as C2 |
| C4 | `TARGET\nGG SHRP CHDR CHS 3.29\nGG BBY SPNCH 3.99\nUP&UP WIPES 5.49\nTOTAL 12.77` | as C2 |
| C5 | Distinctive brands still flag. Live data has no Jif or Prairie Paws recall (those are fixtures), so pick two current food recalls with a clear brand from `GET /v1/recalls?category=food&limit=50` and type each as a cashier-style line: brand plus one or two product words (for example `ACME GRANOLA BARS 3.99`) | each line is `recalled` or `possible` against its recall; if fixtures were also loaded, `PRAIRIE PAWS DOG FOOD 24.99` is `recalled` |
| C6 | Real store-brand recall: search live data (`GET /v1/recalls?q=great value`, then `kroger`, `kirkland`, `member's mark`, `365`) and pick one food recall whose title names the store brand and a product. Type it as a receipt line in cashier style (for example `GV CHOC CHIP COOKIES 2.98`) | that line is `possible` (or `recalled`) against that recall; store-brand recalls are not suppressed entirely |
| C7 | `POST /v1/scan/match` with `{"ocrText":"great value"}`, `{"ocrText":"Kroger"}`, `{"ocrText":"Zappo Crunch Bar"}` | all `clear`, no matches |
| C8 | Whole-word sanity: for every match in C1–C6, check the matched terms in `explanation` appear as whole words in the recall text (not inside a longer word like "ndl" in "Handler") | no partial-word matches |

Summarize C as a table: lines checked, clear, possible, recalled, judged wrong. **Any `recalled`
judged wrong is a FAIL**; list it verbatim with the recall title.

On the phone (C9): Scan → Receipt → type the C1 lines with "Keep an eye on all of these" off, then
on. Pass: both lines Fine (or Maybe only against a real store-brand recall); the header shows no
"watching" text the first time and "watching all 2" the second.

## Part D: home widgets (phone)

Take a screenshot for every stop (`adb exec-out screencap -p`).

| # | Steps | Pass when |
|---|---|---|
| D1 | With the API running: `adb shell pm clear dev.jusmur.recalltracker`, **do not open the app**, place a **Recall status** widget | widget shows "Open Recall Tracker" and "Open the app once and we'll start checking what you watch." Tapping it opens the app |
| D2 | App opens and signs in as a new free user. Re-run the SQL from part B for this newest user, toggle a chip off and on, go back to the home screen | within a few seconds the widget shows "N recalls match your diet profile" (or "N things need a look"), up to three rows with severity words, "Checked just now". **No row or title names peanut, milk, gluten, halal, kosher, vegan, mustard or "allergy"** |
| D3 | Tap the widget background; go back; tap the first row | background opens the Alerts tab; the row opens that alert's detail |
| D4 | Tap "↻ Refresh" | footer briefly shows "Checking…", then "Checked just now" |
| D5 | In the app, resolve or dismiss the top alert; return to the home screen | the widget count drops by one without tapping Refresh |
| D6 | Resize the widget narrow (about 3x2 or smaller), then large (5x4 if the launcher allows) | narrow: title and footer only, nothing clipped; large: three rows; text truncates with "…" rather than overlapping |
| D7 | Stop the API; tap Refresh | after "Checking…", the footer reads "Couldn't refresh · Checked N min ago" and the previous content stays (no invented "all clear"); restart the API, tap Refresh: footer back to "Checked just now" |
| D8 | Staleness: stop the API; Settings → Date & time → turn off automatic, move the date 3 days ahead; force an update with the `am broadcast` command above (or tap Refresh) | the footer says "Checked 3 days ago" with "Couldn't refresh"; if no alerts were open it reads "Not checked recently", never "You're all clear". Restore automatic date and time and restart the API |
| D9 | Background refresh without opening the app: with the API running, dismiss one open alert directly in the database (`UPDATE "Alert" SET "dismissedAt" = now() WHERE id = '<an open alert of this user>'`), move the clock 7 hours ahead, broadcast the update | the widget refetches on its own and the count drops; restore the clock |
| D10 | Place a **Quick scan** widget; tap "Scan a product"; go home; tap "Check a receipt" | the app opens on Scan with Product selected, then with Receipt selected (also when the app was already open on another tab). Record whether tapping the same button twice in a row reselects it after you switched tabs manually in between |
| D11 | Quick scan look | both buttons bordered with even spacing, labels on one line; at `font_scale 1.3` and `1.6` labels truncate with "…" or fit, never clipped; reset to 1.0 |
| D12 | Dark mode (`adb shell cmd uimode night yes`) | both widgets still readable (they keep their light cards); reset |
| D13 | Reboot the phone (`adb reboot`), wait for the launcher | both widgets redraw with the last saved state (no blank widget) |
| D14 | In the app: You → About this app → Delete my data → Delete | the Recall status widget returns to "Open Recall Tracker" within a few seconds |
| D15 | Battery and logs: `adb logcat -d \| grep -i -E "RNWidget\|AndroidWidget\|HeadlessJs" \| tail -40` after the steps above | no crash or ANR lines from the widget task; note any errors verbatim |

## Part E: tests (Codex)

`npm run typecheck`, `TEST_DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_test npm test -w @recall/api`
(expect **123**), `npm test -w @recall/mobile` (expect **24**, including the widget model and
widget layout tests).

## Report (you)

Write `$ROOT/ROUND5_REPORT.md`:

1. Environment: device and Android version, commit, recall counts by source and which were live,
   build type per part.
2. Tables: A1–A5, B1–B4, C1–C9 (with the per-line judgement table), D1–D15, tests. PASS/FAIL,
   screenshot, one-line note.
3. Still broken: steps, expected, actual, screenshot, your guess at the file
   (`apps/mobile/src/widgets/*` for widgets, `apps/api/src/matching/engine.ts` and
   `apps/api/src/scan/*` for receipts).
4. New problems.
5. Codex vs Claude call split.

Show me the report and attach: D2 (widget with alerts), D6 narrow, D7, D8, D10 receipt, B2 paywall,
A5 "can't check", and the C summary table as text.

## Rules

- No commits, no pushes, no edits under `apps/` or `packages/`.
- Restore before you finish: automatic date and time on, `font_scale 1.0`, dark mode off, API
  running.
- If a Codex call is silent for 25 minutes, kill it, read the last 20 lines, relaunch narrower.
- If only I can unblock you (phone locked, the widget picker needs a human, a permission dialog),
  say exactly what in one sentence.
