import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "recall.token";
const INSTALL_KEY = "recall.installId";

async function get(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}
async function set(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function getToken(): Promise<string | null> {
  return get(TOKEN_KEY);
}
export async function setToken(token: string): Promise<void> {
  await set(TOKEN_KEY, token);
}

/** Stable per-install id; created once and kept in the keychain. */
export async function getInstallId(): Promise<string> {
  const existing = await get(INSTALL_KEY);
  if (existing) return existing;
  const id = `${Platform.OS}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 12)}`;
  await set(INSTALL_KEY, id);
  return id;
}
