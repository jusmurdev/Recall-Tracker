import React from "react";
import { describe, expect, it } from "vitest";

const { buildWidgetTree } = await import("react-native-android-widget-tree");
const { RecallStatusWidget, QuickScanWidget } = await import("./widgets");
const { buildSnapshot, widgetView } = await import("./model");

type Node = { type: string; props: Record<string, unknown>; children?: Node[] };
const walk = (n: Node, out: Node[] = []): Node[] => {
  out.push(n);
  for (const c of n.children ?? []) walk(c, out);
  return out;
};
const texts = (n: Node) => walk(n).filter((x) => x.type === "TextWidget").map((x) => String(x.props.text));
const clicks = (n: Node) => walk(n).filter((x) => x.props.clickAction).map((x) => ({ action: x.props.clickAction, data: x.props.clickActionData }));

const NOW = new Date("2026-10-05T12:00:00Z");
const alert = (id: string, severity: "critical" | "high") => ({ id, reason: "brand_match" as const, score: 0.8, readAt: null, resolvedAt: null, dismissedAt: null, recall: { title: `Acme: Item ${id}`, productDescription: "x", source: "FDA" as const, severity, headline: `Item ${id}` } });

describe("Android widget layouts", () => {
  it("builds the status widget with tappable alert rows and a refresh button", () => {
    const view = widgetView(buildSnapshot({ alerts: [alert("a", "critical"), alert("b", "high")], watching: 4, dietOn: false, checkedAt: NOW }), NOW);
    const tree = buildWidgetTree(React.createElement(RecallStatusWidget, { view, width: 320 })) as Node;
    expect(texts(tree)).toEqual(expect.arrayContaining(["2 things need a look", "Item a", "Item b", "Serious", "Moderate", "Checked just now", "↻ Refresh"]));
    expect(clicks(tree)).toEqual(
      expect.arrayContaining([
        { action: "OPEN_URI", data: { uri: "recalltracker://alerts" } },
        { action: "OPEN_URI", data: { uri: "recalltracker://alert/a" } },
        { action: "REFRESH", data: {} },
      ]),
    );
  });
  it("drops the rows when the widget is narrow, and shows 'Checking…' while refreshing", () => {
    const view = widgetView(buildSnapshot({ alerts: [alert("a", "critical")], watching: 1, dietOn: false, checkedAt: NOW }), NOW);
    const tree = buildWidgetTree(React.createElement(RecallStatusWidget, { view, width: 200, checking: true })) as Node;
    expect(texts(tree)).not.toContain("Item a");
    expect(texts(tree)).toContain("Checking…");
  });
  it("builds the empty state without claiming all clear", () => {
    const tree = buildWidgetTree(React.createElement(RecallStatusWidget, { view: widgetView(null, NOW), width: 320 })) as Node;
    expect(texts(tree).join(" ")).not.toMatch(/all clear/i);
    expect(texts(tree)).toContain("Open Recall Tracker");
  });
  it("builds the quick scan buttons with deep links to each scanner", () => {
    const tree = buildWidgetTree(React.createElement(QuickScanWidget)) as Node;
    expect(texts(tree)).toEqual(["Scan a product", "Check a receipt"]);
    expect(clicks(tree).map((c) => (c.data as { uri: string }).uri)).toEqual(["recalltracker://scan?target=product", "recalltracker://scan?target=receipt"]);
  });
});
