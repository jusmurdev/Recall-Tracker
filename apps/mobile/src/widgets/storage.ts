import AsyncStorage from "@react-native-async-storage/async-storage";
import { parseSnapshot, type WidgetSnapshot } from "./model";

const KEY = "recall.widget.snapshot";

/** The widget runs in a background task with no React tree; AsyncStorage is shared with the app. */
export async function loadSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    return parseSnapshot(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function saveSnapshot(s: WidgetSnapshot): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // A widget that can't save just shows its last state; never break the app over it.
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
