import { useEffect } from "react";
import { Platform } from "react-native";
import React from "react";
import { requestWidgetUpdate } from "react-native-android-widget";
import { useAlerts, useMe, useWatchlist } from "@/hooks/queries";
import { hasDiet } from "@/lib/diet";
import { buildSnapshot, widgetView, type WidgetSnapshot } from "./model";
import { clearSnapshot, saveSnapshot } from "./storage";
import { QuickScanWidget, RecallStatusWidget, WIDGET_NAMES } from "./widgets";

/** Redraw every placed widget from a snapshot (null after sign-out or account deletion). */
export async function updateWidgets(snap: WidgetSnapshot | null): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await requestWidgetUpdate({ widgetName: WIDGET_NAMES.status, renderWidget: (info) => <RecallStatusWidget view={widgetView(snap, new Date())} width={info.width} /> });
    await requestWidgetUpdate({ widgetName: WIDGET_NAMES.quickScan, renderWidget: () => <QuickScanWidget /> });
  } catch {
    // No widgets placed, or the native module is missing in this build: nothing to update.
  }
}

/** Account deleted or signed out: the home screen must not keep showing that person's alerts. */
export async function resetWidgets(): Promise<void> {
  await clearSnapshot();
  await updateWidgets(null);
}

/**
 * Keeps widgets in step with the app: whenever alerts load (or are read, resolved, dismissed),
 * save a snapshot and redraw. Uses the time the data was fetched, so cached data restored at
 * launch is not presented as new.
 */
export function WidgetSync() {
  const alerts = useAlerts();
  const list = useWatchlist();
  const me = useMe();
  const dietOn = hasDiet(me.data?.diet);
  const watching = list.data?.items.length ?? 0;
  useEffect(() => {
    if (Platform.OS !== "android" || !alerts.data || !alerts.dataUpdatedAt) return;
    const snap = buildSnapshot({ alerts: alerts.data.items, watching, dietOn, checkedAt: new Date(alerts.dataUpdatedAt) });
    void saveSnapshot(snap).then(() => updateWidgets(snap));
  }, [alerts.data, alerts.dataUpdatedAt, watching, dietOn]);
  return null;
}
