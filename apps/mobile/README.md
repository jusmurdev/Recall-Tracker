# Recall Tracker — mobile

Expo Router app. See the repository README for the full picture.

```bash
npm install                       # from the repo root
npm run dev:mobile                # Expo dev server (Expo Go: everything except OCR)
cd apps/mobile && npx expo prebuild && npx expo run:ios   # development build with ML Kit OCR
```

iOS build checklist (already configured in `app.json` / `eas.json`):
- Purpose strings: camera, location when-in-use, location always, photo library.
- `UIBackgroundModes`: `remote-notification`, `location`; `aps-environment` entitlement.
- `usesNonExemptEncryption: false`; `expo-location` plugin with background location on.
- Placeholder icons in `assets/` — replace before App Store submission.
- Fill `extra.eas.projectId`, `updates.url`, and `submit.production.ios` in `eas.json`.

Location features: on-device state detection (only the state is uploaded), "Near me" feed
filter, "I'm here" restaurant pinning with nearby tracked restaurants, and geofence arrival
alerts for tracked restaurants with active supplier recalls (Settings → Restaurant arrival alerts).

On-device OCR lives in `modules/vision-ocr` (Swift + Kotlin, autolinked by Expo). After
changing it: `npx expo prebuild --clean` then `npx expo run:ios` / `run:android`. The JS
facade in `src/lib/ocr.ts` falls back to the ML Kit package, then to manual entry, so the app
still works in Expo Go.

Config:
- `EXPO_PUBLIC_API_URL` or `extra.apiBaseUrl` in `app.json` — API base URL.
- `extra.eas.projectId` — needed for Expo push tokens on real devices.
- Bundle ids in `app.json` (`ios.bundleIdentifier`, `android.package`).

Screens (`app/`):
- `(tabs)/index` Home (status hero, quick actions, serious recalls near you), `(tabs)/browse`
  feed with search + filters, `(tabs)/scan` camera (barcode + OCR), `(tabs)/alerts`,
  `(tabs)/settings` ("You"), `(tabs)/watchlist` (hidden tab, reached from Home)
- `src/lib/friendly.ts` turns agency text into plain language (headline, reason, severity,
  grade copy); `src/lib/theme.ts` holds the palette
- `recall/[id]`, `alert/[id]`, `watch/new`, `watch/restaurant` (premium), `watch/[id]`
- `premium/index`, `premium/connectors` (MCP account linking + import)

Everything that crosses the network is typed by `@recall/shared`.
