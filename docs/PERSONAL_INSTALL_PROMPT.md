# Recall Tracker: personal install on my Android phone (real data, all features unlocked)

Paste everything below this line into Claude Code on the desktop.

---

Set up Recall Tracker so I can use it on my own Android phone as an everyday user. This is not a
test run: I want real recall data only, everything unlocked, and an app that keeps working after
setup. No payments. The phone is connected over `adb`. Use OpenAI Codex CLI (`codex exec`) for
long or noisy steps (install, Gradle, log reading) as in earlier runs, and keep your own reading
to short summaries.

Do not edit tracked code and do not commit or push. Machine-specific settings go in
`apps/api/.env` and in local, uncommitted changes to `apps/mobile/app.json`, nowhere else.
Never print API keys back to me.

## 0. Ask me first (one message, then wait)

Ask these together:

1. **How should the phone reach the server?**
   - **Anywhere (recommended):** Tailscale on this computer and the phone, same account. Works on
     mobile data and other Wi-Fi.
   - **Home Wi-Fi only:** the phone uses this computer's LAN address.
   - **USB only:** `adb reverse`; the app only works while plugged in.
2. **Optional keys** (each can be skipped; tell me what I lose):
   - AI provider key: Anthropic, OpenAI or Gemini. Needed for restaurant research (it uses web
     search). Photo identification and receipt-photo decoding also work with a local model.
   - Use my local `llama-server` (port 8081) as a free AI option for those last two? Ask which
     model it serves and whether it can read images.
   - Google Maps Android API key, for map tiles. Without it the restaurant screen shows a list.
   - Push notifications: needs a free Expo account and a Firebase project (steps in part 6). I do
     the account steps myself; you tell me exactly what to click.

## 1. Code

```bash
git clone https://github.com/jusmurdev/Recall-Tracker.git ~/recall-tracker-personal   # or reuse an existing clone
cd ~/recall-tracker-personal
git fetch origin feature/diet-profiles-and-fixes && git checkout feature/diet-profiles-and-fixes && git pull
npm install
npm run build -w @recall/shared
```

Use this branch: it has every feature and fix. `private/app` is older.
If an earlier test clone exists, use a separate directory so test settings don't leak in.

## 2. Database with real data only

Earlier test rounds loaded **sample recalls** (Jif, Prairie Paws, demo diet recalls) that are not
real. Use a **new, separate database** so none of that appears on my phone, and **never run
`ingest:fixtures` or `seed:demo` against it**.

1. With the user-local Postgres and Redis from earlier runs, create database
   `recall_tracker_personal` (owner `recall`).
2. Write `apps/api/.env` from `apps/api/.env.example` with:
   - `DATABASE_URL=postgresql://recall:recall@localhost:5432/recall_tracker_personal`
   - `REDIS_URL=redis://localhost:6379`
   - `INGEST_USE_FIXTURES=0`
   - `CONNECTOR_ENCRYPTION_KEY=` a fresh `openssl rand -hex 32`
   - AI settings from step 0, if any:
     - Anthropic: `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…`
     - OpenAI: `AI_PROVIDER=openai`, `OPENAI_API_KEY=…`
     - Gemini: `AI_PROVIDER=gemini`, `GEMINI_API_KEY=…`
     - Local model only: `AI_PROVIDER=openai-compatible`, `AI_COMPAT_BASE_URL=http://localhost:8081/v1`,
       `AI_COMPAT_MODEL=<its model name>`, `AI_COMPAT_VISION=1` only if it reads images
     - A cloud key plus the local model: cloud as `AI_PROVIDER`, `AI_PROVIDER_FALLBACKS=openai-compatible`
   - leave `AI_PROVIDER_FALLBACKS` empty otherwise.
3. `npm run prisma:generate -w @recall/api`, then `npm run prisma:migrate -w @recall/api`.
4. `npm run ingest:once -w @recall/api`. FDA loads live. USDA FSIS returned HTTP 403 from this
   machine before; if so, leave it empty rather than loading samples, and tell me meat and poultry
   recalls are missing. Report the count per source.

## 3. Keep the server running

The app needs the API (port 4000) and the worker running whenever I use it. The worker fetches
new recalls several times a day and creates alerts.

- Run both as **systemd user services** (`systemctl --user`), with
  `WorkingDirectory` at the repo, `ExecStart=npm run dev:api -w @recall/api` and
  `npm run dev:worker -w @recall/api`, `Restart=on-failure`, and the `.env` loaded. Enable them
  and run `loginctl enable-linger $USER` so they start at boot without a login. Make sure
  Postgres and Redis also start at boot the same way they run now.
- If systemd user services are not available, use `tmux` and tell me they stop on reboot.
- Check: `curl -s localhost:4000/health`.
- Tell me plainly: the computer must stay on (sleep disabled) for the app to update.

## 4. Network (from my answer in step 0)

- **Tailscale:** install on this computer (`curl -fsSL https://tailscale.com/install.sh | sh`,
  `sudo tailscale up`; I approve the login in a browser). I install Tailscale on the phone from
  Play Store and sign into the same account. Get this computer's Tailscale IPv4 address
  (`tailscale ip -4`, a `100.x.y.z` address). Allow TCP 4000 on the `tailscale0` interface if a
  firewall is active. From the phone, with Wi-Fi off and mobile data on, confirm the address works
  (open `http://100.x.y.z:4000/health` in the phone browser).
  `API_URL=http://100.x.y.z:4000`. Tailscale encrypts the traffic.
- **Home Wi-Fi:** use this computer's LAN IPv4 address; reserve it in the router if possible or
  the app breaks when it changes. Allow TCP 4000 on the LAN only, never on the internet.
  `API_URL=http://192.168.x.y:4000`.
- **USB only:** `adb reverse tcp:4000 tcp:4000`; `API_URL=http://127.0.0.1:4000` (not
  `localhost`). Re-run `adb reverse` after every reconnect.

The API is plain HTTP, so the build in step 5 uses the QA cleartext flag. Do not open port 4000
to the public internet.

## 5. Build and install the app

```bash
cd ~/recall-tracker-personal/apps/mobile
# Optional: put the Maps key into app.json → expo.android.config.googleMaps.apiKey (local change only)
RECALL_QA_CLEARTEXT=1 npx expo prebuild -p android --clean
adb uninstall dev.jusmur.recalltracker || true     # removes any test build and its test data
EXPO_PUBLIC_API_URL="$API_URL" npx expo run:android --variant release --device
```

- This is a release build: no Metro or debug toast needed, it runs on its own after install.
- It is signed with Expo's debug key. That is fine for my phone, but updating later must also come
  from this machine (or uninstall first).
- The API address is built into the app. If it changes, rebuild.

Then on the phone: open the app once while the server is reachable, and allow location and camera
when asked (notifications too if part 6 is done).

**Unlock everything** (the app has no purchase flow; this is how Premium is turned on):

```sql
-- in recall_tracker_personal
UPDATE "User" SET tier = 'premium'
WHERE "installId" = (SELECT "installId" FROM "User" WHERE "installId" LIKE 'android-%' ORDER BY "createdAt" DESC LIMIT 1);
```

Then pull to refresh Home. I set my own diet profile and watch items in the app; do not add any.

## 6. Optional: push notifications (only if I said yes)

Without this, alerts still appear in the app and on the home screen widget, just not as
notifications. Guide me through the account steps; do the file and build steps yourself.

1. **Me:** create a free Expo account. **You:** in `apps/mobile`, `npx eas-cli login`, then
   `npx eas-cli init` to fill `expo.extra.eas.projectId` in `app.json` (local change only).
2. **Me:** in the Firebase console, create a project, add an Android app with package name
   `dev.jusmur.recalltracker`, download `google-services.json`. **You:** save it as
   `apps/mobile/google-services.json`, set `expo.android.googleServicesFile` to
   `./google-services.json` in `app.json`, and keep it out of git.
3. **Me:** in Firebase, Project settings → Service accounts → generate a private key (JSON).
   **You:** upload it for FCM v1 with `npx eas-cli credentials` (Android → Google Service Account
   → FCM V1). Keep the JSON out of the repo and delete the local copy afterwards.
4. Optional: an Expo access token as `EXPO_ACCESS_TOKEN` in `apps/api/.env`; restart the API.
5. Rebuild and install (step 5 commands, keeping `RECALL_QA_CLEARTEXT=1`), open the app, allow
   notifications. You · Notifications should no longer say push is unavailable, and
   `SELECT count(*) FROM "Device";` should be 1.
6. To prove it end to end, add a watch item that matches a current recall and confirm a
   notification arrives. Remember quiet hours (default off) and the daily summary setting.

## 7. Hand-over check (quick, as a user would)

With the phone **unplugged** (unless I chose USB only), confirm and report:

- Home loads, Browse shows current FDA recalls with readable headlines, search works.
- Watch a brand I name, scan a real product label and a real receipt from my kitchen.
- You → Diet and allergies saves, and Premium shows as on.
- Restaurants near me: list (and map if a Maps key was set); restaurant research works only with a
  cloud AI key.
- Place the "Recall status" and "Quick scan" widgets; both work.

Then give me a short summary:
- What is on and what is off, and why.
- The API address the app uses.
- How to restart the server: `systemctl --user restart …`.
- How to update later: `git pull`, `npm install`, migrate, then rebuild with the step 5 commands.
- A reminder that the computer must stay on.

## Rules

- Real data only: no fixtures, no seed data in `recall_tracker_personal`.
- No commits, no pushes; secrets only in `apps/api/.env` or files kept out of git.
- Don't expose port 4000 to the public internet.
- If something needs me (logins, Firebase, Play Store, unlocking the phone), say exactly what in
  one sentence and wait.
