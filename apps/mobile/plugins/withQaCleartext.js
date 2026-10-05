/**
 * QA builds only: allow plain HTTP so a release APK can reach a local API at
 * http://127.0.0.1:4000 through `adb reverse`. Enabled only when RECALL_QA_CLEARTEXT=1 is set at
 * prebuild time; production builds never get it. Debug builds already allow cleartext.
 *
 *   RECALL_QA_CLEARTEXT=1 npx expo prebuild -p android --clean
 *   EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 npx expo run:android --variant release --device
 */
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withQaCleartext(config) {
  if (process.env.RECALL_QA_CLEARTEXT !== "1") return config;
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return cfg;
  });
};
