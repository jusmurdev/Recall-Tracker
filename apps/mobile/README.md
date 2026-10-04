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

Config:
- `EXPO_PUBLIC_API_URL` or `extra.apiBaseUrl` in `app.json` — API base URL.
- `extra.eas.projectId` — needed for Expo push tokens on real devices.
- Bundle ids in `app.json` (`ios.bundleIdentifier`, `android.package`).

Screens (`app/`):
- `(tabs)/index` recall feed with search + filters, `(tabs)/scan` camera (barcode + OCR),
  `(tabs)/watchlist`, `(tabs)/alerts`, `(tabs)/settings`
- `recall/[id]`, `alert/[id]`, `watch/new`, `watch/restaurant` (premium), `watch/[id]`
- `premium/index`, `premium/connectors` (MCP account linking + import)

Everything that crosses the network is typed by `@recall/shared`.
