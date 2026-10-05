import { api } from "@/api/client";
import { getToken } from "@/lib/auth";
import { hasDiet } from "@/lib/diet";
import { buildSnapshot, type WidgetSnapshot } from "./model";
import { saveSnapshot } from "./storage";

const TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))]);
}

/**
 * Fetch fresh alert state for the widget. Only for an install that has signed in already: the
 * widget never creates an account. Returns null when it can't (no account yet, offline, error).
 */
export async function refreshSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    if (!(await getToken())) return null;
    const [alerts, list, me] = await withTimeout(Promise.all([api.alerts(), api.watchlist(), api.me()]));
    const snap = buildSnapshot({ alerts: alerts.items, watching: list.items.length, dietOn: hasDiet(me.diet), checkedAt: new Date() });
    await saveSnapshot(snap);
    return snap;
  } catch {
    return null;
  }
}
