import Constants from "expo-constants";
import { Platform } from "react-native";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string };

/**
 * API base URL. Override at build time via app.json `extra.apiBaseUrl` or EXPO_PUBLIC_API_URL.
 * Android emulators reach the host machine through 10.0.2.2.
 */
export function apiBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const url = fromEnv ?? extra.apiBaseUrl ?? "http://localhost:4000";
  if (Platform.OS === "android" && url.includes("localhost")) return url.replace("localhost", "10.0.2.2");
  return url;
}
