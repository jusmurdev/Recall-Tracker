/**
 * Runs headless when Android asks a widget to draw: added, periodic update (every 30 min at
 * most, set in app.json), resized, or a tap on "Refresh". Draws the saved state first so the
 * widget never sits blank, then refreshes when the data is stale or the user asked.
 */
import React from "react";
import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { STALE_AFTER_MS, widgetView, type WidgetSnapshot } from "./model";
import { refreshSnapshot } from "./refresh";
import { loadSnapshot } from "./storage";
import { QuickScanWidget, RecallStatusWidget, WIDGET_NAMES } from "./widgets";

const isStale = (s: WidgetSnapshot | null, now: Date) => !s || now.getTime() - Date.parse(s.checkedAt) > STALE_AFTER_MS;

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const { widgetInfo, widgetAction, clickAction, renderWidget } = props;
  if (widgetAction === "WIDGET_DELETED") return;
  if (widgetInfo.widgetName === WIDGET_NAMES.quickScan) {
    renderWidget(<QuickScanWidget />);
    return;
  }
  if (widgetInfo.widgetName !== WIDGET_NAMES.status) return;

  let snap = await loadSnapshot();
  const now = new Date();
  const userAsked = widgetAction === "WIDGET_CLICK" && clickAction === "REFRESH";
  const wantRefresh = userAsked || widgetAction === "WIDGET_ADDED" || (widgetAction === "WIDGET_UPDATE" && isStale(snap, now));
  if (!wantRefresh) {
    renderWidget(<RecallStatusWidget view={widgetView(snap, now)} width={widgetInfo.width} />);
    return;
  }
  renderWidget(<RecallStatusWidget view={widgetView(snap, now)} width={widgetInfo.width} checking />);
  const fresh = await refreshSnapshot();
  if (fresh) snap = fresh;
  renderWidget(<RecallStatusWidget view={widgetView(snap, new Date(), { refreshFailed: !fresh && !!snap })} width={widgetInfo.width} />);
}
