# Screenshots

Captured from the Expo **web export** of the mobile app at iPhone 14 size (390×844 @2x, light
mode) against the API loaded with recorded fixtures and the demo seed. Native-only features
(camera, OCR, geofencing, push) show their permission/fallback states on web.

| | | |
| --- | --- | --- |
| ![](01-home.png) Home | ![](01a-browse.png) Browse | ![](01b-browse-search.png) Search |
| ![](02-recall-detail.png) Recall detail | ![](03-scan.png) Scan | ![](04-watchlist.png) Things you watch |
| ![](05-watch-new.png) Add a brand | ![](06-subscribe.png) Follow a category | ![](07-restaurant-detail.png) Restaurant + health grade |
| ![](08-restaurant-add.png) Add restaurant | ![](08b-restaurant-catalog-search.png) Catalog search | ![](09-alerts.png) Alerts |
| ![](10-alert-detail.png) Alert detail | ![](11-restaurant-updates.png) Restaurant updates | ![](12-premium.png) Premium |
| ![](13-connectors.png) Connected accounts | ![](14-settings.png) You | |

## Regenerate

```bash
# 1. API with fixture data + demo user (token: demo-token-for-screenshots)
cd apps/api
npm run ingest:fixtures
DEMO_TOKEN=demo-token-for-screenshots npm run seed:demo
INGEST_USE_FIXTURES=1 npm run dev          # port 4000

# 2. Web export of the app, served with SPA fallback
cd apps/mobile
EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo export --platform web --output-dir dist
node scripts/serve-web-export.mjs dist     # port 8080

# 3. Capture (needs `playwright` + a Chromium: npx playwright install chromium)
node scripts/screenshots.mjs ../../docs/screenshots
```
