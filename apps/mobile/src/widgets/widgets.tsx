/**
 * Android home screen widgets (react-native-android-widget). Layout only: what they say comes
 * from model.ts. Widgets cannot use hooks or app state; they are rebuilt from a view each time.
 */
import React from "react";
import { FlexWidget, TextWidget } from "react-native-android-widget";
import type { RecallSeverity } from "@recall/shared";
import type { WidgetTone, WidgetView } from "./model";

export const WIDGET_NAMES = { status: "RecallStatus", quickScan: "QuickScan" } as const;

// Theme colors (src/lib/theme.ts) as literal hex: widgets render outside the React tree.
const C = {
  text: "#1F2A33",
  muted: "#6B7781",
  card: "#FFFFFF",
  border: "#E6E0D4",
  accent: "#1F8A80",
  accentSoft: "#DDEFEC",
} as const;
const TONE_BG: Record<WidgetTone, `#${string}`> = { critical: "#FBE4E4", high: "#FBEFD9", clear: "#DFF3E8", unknown: "#F1EDE4" };
const TONE_FG: Record<WidgetTone, `#${string}`> = { critical: "#D64B4B", high: "#B87410", clear: "#2E9E6B", unknown: "#6B7781" };
const SEV_FG: Record<RecallSeverity, `#${string}`> = { critical: "#D64B4B", high: "#B87410", low: "#4A7FC1", unknown: "#6B7781" };
const ICON: Record<WidgetTone, string> = { critical: "!", high: "!", clear: "✓", unknown: "?" };

/** Recall status. Below about 250 dp wide it drops the alert rows and keeps the headline. */
export function RecallStatusWidget({ view, width, checking }: { view: WidgetView; width: number; checking?: boolean }) {
  const compact = width < 250;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: view.uri }}
      accessibilityLabel={`${view.title}. ${view.subtitle}`}
      style={{ height: "match_parent", width: "match_parent", backgroundColor: TONE_BG[view.tone], borderRadius: 22, padding: 14, flexDirection: "column", justifyContent: "space-between" }}
    >
      <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", flexGap: 10 }}>
        <FlexWidget style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: TONE_FG[view.tone], alignItems: "center", justifyContent: "center" }}>
          <TextWidget text={ICON[view.tone]} style={{ fontSize: 16, fontWeight: "bold", color: "#FFFFFF" }} />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: "column" }}>
          <TextWidget text={view.title} maxLines={2} truncate="END" style={{ fontSize: compact ? 15 : 16, fontWeight: "bold", color: C.text }} />
          {compact ? null : <TextWidget text={view.subtitle} maxLines={1} truncate="END" style={{ fontSize: 12, color: C.muted }} />}
        </FlexWidget>
      </FlexWidget>

      {!compact && view.rows.length ? (
        <FlexWidget style={{ width: "match_parent", flexDirection: "column", flexGap: 6, marginTop: 8 }}>
          {view.rows.map((r) => (
            <FlexWidget
              key={r.id}
              clickAction="OPEN_URI"
              clickActionData={{ uri: r.uri }}
              accessibilityLabel={`${r.label} recall: ${r.text}`}
              style={{ width: "match_parent", flexDirection: "row", alignItems: "center", flexGap: 8, backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 7 }}
            >
              <TextWidget text={r.label} style={{ fontSize: 11, fontWeight: "bold", color: SEV_FG[r.severity] }} />
              <TextWidget text={r.text} maxLines={1} truncate="END" style={{ fontSize: 13, color: C.text }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : null}

      <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <TextWidget text={checking ? "Checking…" : view.footer} maxLines={1} truncate="END" style={{ fontSize: 11, color: C.muted }} />
        <FlexWidget
          clickAction="REFRESH"
          accessibilityLabel="Check for new recalls now"
          style={{ backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 4 }}
        >
          <TextWidget text="↻ Refresh" style={{ fontSize: 11, fontWeight: "bold", color: C.accent }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}

function ScanButton({ label, target, primary }: { label: string; target: "product" | "receipt"; primary?: boolean }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: `recalltracker://scan?target=${target}` }}
      accessibilityLabel={label}
      style={{ flex: 1, height: "match_parent", alignItems: "center", justifyContent: "center", borderRadius: 16, borderWidth: 1.5, borderColor: primary ? "#18736B" : C.accent, backgroundColor: primary ? C.accent : C.card, paddingHorizontal: 8 }}
    >
      <TextWidget text={label} maxLines={1} truncate="END" style={{ fontSize: 14, fontWeight: "bold", color: primary ? "#FFFFFF" : C.accent }} />
    </FlexWidget>
  );
}

/** Two bordered buttons that open the scanner on the right tab. */
export function QuickScanWidget() {
  return (
    <FlexWidget style={{ height: "match_parent", width: "match_parent", backgroundColor: "#F7F4EE", borderRadius: 22, padding: 8, flexDirection: "row", flexGap: 8 }}>
      <ScanButton label="Scan a product" target="product" primary />
      <ScanButton label="Check a receipt" target="receipt" />
    </FlexWidget>
  );
}
