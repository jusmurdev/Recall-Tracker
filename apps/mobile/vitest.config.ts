import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Tests never load real React Native (Flow source); a small stub covers the widget library.
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "react-native": path.resolve(__dirname, "src/test/react-native-stub.ts"),
      // Its CommonJS build require()s react-native directly, past the alias; use the ES module build.
      "react-native-android-widget-tree": path.resolve(__dirname, "../../node_modules/react-native-android-widget/lib/module/api/build-widget-tree.js"),
      "react-native-android-widget": path.resolve(__dirname, "../../node_modules/react-native-android-widget/lib/module/index.js"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Transform the widget library so tests can stub the React Native globals it imports.
    server: { deps: { inline: [/react-native-android-widget/] } },
  },
});
