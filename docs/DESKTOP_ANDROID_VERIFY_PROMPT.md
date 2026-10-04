# Recall Tracker: verify the device-bug fixes and the dietary profiles on the Android phone

Paste everything below this line into Claude Code on the desktop.

---

You are the **orchestrator**; OpenAI **Codex CLI** (`codex exec`) is your **worker**. Set up the
stack exactly as `docs/DESKTOP_ANDROID_TEST_PROMPT.md` in the repo describes (same token
discipline, same Codex call template, same phases 0 to 5), then run the verification tour below
instead of that file's generic tour. Read that file first; it has the project facts, the
`adb reverse` and `EXPO_PUBLIC_API_URL=http://127.0.0.1:4000` rule, and the screenshot commands.

## What changed, and why you are here

A previous device run on this phone (Samsung SM-A166U, Android 16, 3-button navigation) found 17
bugs. They have been fixed on branch **`feature/diet-profiles-and-fixes`**, which also adds a new
free feature, **dietary profiles** (allergies, gluten-free, halal, kosher, vegan). Your job is to
confirm each fix on the real phone, exercise the new feature end to end, and report with
screenshots. Do not fix app code unless a step is blocked; list bugs instead.

Branch and setup differences from the generic prompt:

- Clone and check out **`feature/diet-profiles-and-fixes`** (not `private/app`). The branch is on
  GitHub; `git fetch origin feature/diet-profiles-and-fixes` if the clone did not bring it.
- Two new migrations must apply: `20261006000000_gtin14` and `20261006030000_diet_profiles`.
  `npm run prisma:migrate -w @recall/api` on a fresh database must print no errors.
- The seed now creates seven diet demo recalls and gives the demo user a diet profile. After
  `DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo -w @recall/api`, expect the JSON
  output to show `"dietAlerts": 9` (or higher).
- There is **no Google Maps key** in this build on purpose. The map screen must not crash.

## Phase A: API checks (Codex, one call, writes `.work/api-checks.md`)

Run these with `curl` against `http://localhost:4000` and record PASS/FAIL with the response:

| # | Check | Expect |
|---|---|---|
| A1 | `POST /v1/auth/anonymous` with `{"installId":"verify-phone-1","platform":"android","timezone":"America/Chicago"}` | 200, token; then `GET /v1/me` shows `preferences.timezone` = America/Chicago |
| A2 | `POST /v1/scan/match` `{"ocrText":"Prairie Paws dog food"}` | `status` = `recalled`, first match is the Prairie Paws recall |
| A3 | `POST /v1/scan/match` `{"ocrText":"MILK"}` | `status` = `clear`, `matches` empty |
| A4 | `POST /v1/scan/receipt` `{"ocrText":"PETSMART\nPRAIRIE PAWS DOG FOOD 24.99\nMILK 3.19\nTOTAL 28.18"}` | Prairie Paws line `recalled`, MILK line present and `clear` |
| A5 | `POST /v1/scan/match` with `{"upc":"087654321098"}`, `{"upc":"0087654321098"}`, `{"upc":"0 87654 32109 8"}` | all three: one `upc_exact` match, same recall |
| A6 | `GET /v1/recalls?q=%25` and `?q=_` | 200, zero items (wildcards escaped) |
| A7 | `GET /v1/recalls?state=ZZ`; `PUT /v1/me/location` `{"state":"XX"}`; `PATCH /v1/me/preferences` `{"homeState":"QQ"}` | all 400 with `code: "validation"` |
| A8 | `POST /v1/watchlist` `{"kind":"product","label":"<b>Skippy</b> peanut butter"}` twice | first 201 with label `Skippy peanut butter` and terms containing `skippy`; second 200 with `duplicate: true` and the same item id |
| A9 | `POST /v1/watchlist` with body `{not json` and `Content-Type: application/json`; then with `Content-Type: application/xml` | 400 `code: "bad_json"`; 415 `code: "unsupported_media_type"`; `GET /v1/nope` is 404 `code: "not_found"` |
| A10 | `GET /v1/recalls?limit=50` | every item has a `headline` of 70 characters or fewer with no leading `COMPANY:` prefix and no all-caps shouting; note any that still look raw |
| A11 | `PATCH /v1/me/preferences` `{"dietProfiles":["allergy_peanut","vegan"],"otherAllergens":["mustard"]}` | 200, `diet` echoes it, `dietAlertsAdded` ≥ 1; `{"dietProfiles":["paleo"]}` is 400 |
| A12 | `GET /v1/recalls?diet=1` with the token; then without a token | with: items each carry `dietHit.explanation`; without: 401 |
| A13 | `POST /v1/scan/match` `{"ocrText":"ZAPPO CRUNCH BAR\nINGREDIENTS: SUGAR, RICE, CASEIN, PORK GELATIN, MUSTARD FLOUR"}` with the diet user | `status` = `clear`, `diet` lists a mustard-allergy hit (and milk/vegan hits if those profiles are on) |
| A14 | `DELETE /v1/me` for the verify user, then `GET /v1/me` | 204 then 401 |

## Phase B: phone tour (Codex, agent mode, screenshots to `.work/shots/`, notes to `.work/tour.md`)

The phone signs in as its own anonymous user. Give that user premium and a diet profile with one
SQL statement against the local database, then pull to refresh Home:

```sql
UPDATE "User"
SET tier = 'premium',
    "dietProfiles" = ARRAY['allergy_peanut','allergy_milk','gluten_free','halal','kosher','vegan'],
    "otherAllergens" = ARRAY['mustard']
WHERE "installId" LIKE 'android-%';
```

Alerts are backfilled only when the profile is saved from the app, so after the SQL toggle one
allergy chip off and on in Settings; that triggers the backfill. The demo user created by the
seed (token `demo-token-for-screenshots`) is for API checks only; its token cannot be loaded onto
the phone.

For every stop: screenshot, one line of what was expected and what was seen, PASS/FAIL. On every
screenshot also check: no button under the system navigation bar, every button has a border and
even spacing, no clipped or mid-word-wrapped text, US spelling.

| # | Stop | Pass when |
|---|---|---|
| B1 | Recall detail, scroll to the bottom | "I have this" and "Share" sit fully above the Android nav bar and are tappable |
| B2 | Alert detail, bottom | "Manage what you're watching" is above the nav bar; the four decision buttons are stacked with borders and even gaps |
| B3 | Track a restaurant (premium), bottom | "Track it" is above the nav bar; typing "Capitol Deli" and picking the catalog hit shows only "Great, we already know Capitol Deli", not also "New to us" |
| B4 | Tab bar | icons and labels sit above the nav buttons on every tab |
| B5 | Scan tab, "Type it in instead", type `Prairie Paws dog food`, Check it | verdict is "This might be recalled" with the Prairie Paws recall; no "Looks fine" |
| B6 | Scan tab, type `MILK` | "Looks fine" |
| B7 | Scan tab, type a receipt in receipt mode: `PRAIRIE PAWS DOG FOOD 24.99` / `MILK 3.19` | first line Recalled, MILK line listed as Fine (not missing) |
| B8 | Home → "Eating out? See what's safe nearby" | no crash; a note says the map is not available in this build and the list of places shows (grant location when asked) |
| B9 | You tab, Notifications card | a notice says push isn't available in this build and names the phone's time zone; quiet hours description shows the zone |
| B10 | Turn on airplane mode, open Browse and Scan, type something, Check it | Browse shows "Can't reach the server" with a Retry button (or a stale-data notice above cached rows); Scan shows the friendly message, not `fetch failed: java.io.IOException` |
| B11 | Airplane mode still on, open Home | cached content with an offline notice; then turn airplane mode off and tap Retry: notice disappears |
| B12 | Browse list | headlines read like product names, not `SYSCO BLEND LETT/ROM 50/50…` or `COMPANY: …`; note any that still shout |
| B13 | Watchlist: add "Jif" twice from Watch a brand | second add returns to the same item; the list has one Jif |
| B14 | Browse, tap the search box so the keyboard is open, scroll the category chips | "Food & drink" and the last chip are fully visible, not clipped |
| B15 | You tab, Quiet hours row: tap the **label text**, not the switch | the switch toggles |
| B16 | Premium screen (free user) | reads "Billed through Google Play" |
| B17 | Recall detail → Show details → Barcodes | 12-digit UPC, not 14 digits with leading zeros |
| B18 | You tab → "Diet and allergies" | nine allergen chips, an "Another allergen" box with Add, switches for Gluten-free, Halal diet, Kosher, Vegan; "About diet alerts" link opens the info screen |
| B19 | Tap Peanuts off and on again, then add "lupin" as another allergen | each save sticks after pull-to-refresh; a note appears saying N recalls from the last few weeks match; "lupin" shows as a removable chip |
| B20 | Home | the alert card leads with "N recalls match your …" and diet matches are listed first |
| B21 | Alerts tab | diet alerts show "Undeclared allergen · matters for your peanut allergy" style notes |
| B22 | Open the peanut diet alert | a card named "Peanut allergy" shows "Undeclared · "peanuts"", the explanation, and the phrase highlighted in the notice excerpt; "About diet alerts" button present |
| B23 | Browse → "For my diet" chip | list narrows to diet matches; each row explains why; turn the chip off and the full list returns |
| B24 | Scan, type `Zappo Crunch Bar` then a second line `INGREDIENTS: SUGAR, RICE, CASEIN, PORK GELATIN, MUSTARD FLOUR` | "Looks fine" plus a "Heads up for your diet" card listing milk, halal, kosher, vegan and mustard lines |
| B25 | Scan a real product label in the kitchen with milk or soy in the ingredients | heads-up card appears on the result; note OCR latency |
| B26 | Scan a real receipt | lines with milk, eggs, etc. carry small diet tags |
| B27 | You tab → turn every diet switch and chip off, remove "mustard" and "lupin" | Browse "For my diet" chip now opens Settings instead of filtering; Home no longer leads with diet; existing diet alerts stay in the inbox as history |
| B28 | Kill and relaunch the app | Home renders from cache immediately |

## Phase C: tests (Codex)

`npm run typecheck` and `TEST_DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_test npm test -w @recall/api` and `npm test -w @recall/mobile`. Expect 113 API tests and 9 mobile tests passing. Report counts and any failure's first five lines.

## Phase D: report (you)

Write `$ROOT/VERIFY_REPORT.md`: environment line; a table for A1–A14, B1–B28 and the test run
with PASS/FAIL, screenshot name and a one-line note; a "Still broken" list with steps, expected,
actual, screenshot and your guess at the file; a "New problems" list for anything the fixes
introduced; and the Codex-vs-Claude call split. Show me the report and attach B1, B8, B18, B22
and B24. Do not commit or push.

## Rules

- No pushes, no changes to `main` or `private/app`.
- Keep API keys only in `apps/api/.env`.
- If a Codex call is silent for 25 minutes, kill it, read the last 20 lines, relaunch narrower.
- If only I can unblock you (phone locked, permission dialog, SDK path), say exactly what in one sentence.
