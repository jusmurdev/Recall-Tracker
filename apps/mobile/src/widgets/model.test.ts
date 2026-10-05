import { describe, expect, it } from "vitest";
import { EXPIRED_AFTER_MS, ago, buildSnapshot, parseSnapshot, widgetView } from "./model";

const NOW = new Date("2026-10-05T12:00:00Z");
const recall = (severity: "critical" | "high" | "low" | "unknown", title: string) => ({ title, productDescription: title, source: "FDA" as const, severity, headline: title.split(": ").pop() });
const alert = (id: string, over: Record<string, unknown> = {}) => ({ id, reason: "brand_match" as const, score: 0.8, readAt: null, resolvedAt: null, dismissedAt: null, recall: recall("high", `Acme: Product ${id}`), ...over });

describe("widget snapshot", () => {
  it("counts open alerts, puts diet matches first only while a profile is on, keeps three rows", () => {
    const alerts = [
      alert("a", { recall: recall("critical", "Acme: Serious thing") }),
      alert("b", { reason: "diet_match", recall: recall("low", "Bakery: Cookies") }),
      alert("c"),
      alert("d", { resolvedAt: "2026-10-01T00:00:00Z" }),
      alert("e", { readAt: "2026-10-04T00:00:00Z" }),
    ];
    const on = buildSnapshot({ alerts, watching: 7, dietOn: true, checkedAt: NOW });
    expect(on).toMatchObject({ openCount: 4, unreadCount: 3, dietCount: 1, watching: 7 });
    expect(on.rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    const off = buildSnapshot({ alerts, watching: 7, dietOn: false, checkedAt: NOW });
    expect(off.dietCount).toBe(0);
    expect(off.rows[0]!.id).toBe("a");
  });
  it("rejects missing, malformed or old-format snapshots", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot("{not json")).toBeNull();
    expect(parseSnapshot(JSON.stringify({ version: 0, checkedAt: NOW.toISOString(), rows: [] }))).toBeNull();
    const ok = buildSnapshot({ alerts: [], watching: 1, dietOn: false, checkedAt: NOW });
    expect(parseSnapshot(JSON.stringify(ok))).toEqual(ok);
  });
});

describe("widget wording", () => {
  const snap = (over: Partial<ReturnType<typeof buildSnapshot>> = {}) => ({ ...buildSnapshot({ alerts: [], watching: 5, dietOn: false, checkedAt: NOW }), ...over });

  it("never says all clear without data or from expired data", () => {
    expect(widgetView(null, NOW)).toMatchObject({ tone: "unknown", title: "Open Recall Tracker" });
    const old = snap({ checkedAt: new Date(NOW.getTime() - EXPIRED_AFTER_MS - 60_000).toISOString() });
    const v = widgetView(old, NOW);
    expect(v.title).toBe("Not checked recently");
    expect(v.title).not.toMatch(/clear/i);
  });
  it("says all clear only with fresh data and something watched", () => {
    expect(widgetView(snap(), NOW)).toMatchObject({ tone: "clear", title: "You're all clear", footer: "Checked just now" });
    expect(widgetView(snap({ watching: 0 }), NOW).title).toBe("Nothing watched yet");
  });
  it("leads with diet matches without naming the profile", () => {
    const alerts = [alert("x", { reason: "diet_match", recall: recall("critical", "Sierra Trail: Granola Bars") }), alert("y")];
    const v = widgetView(buildSnapshot({ alerts, watching: 3, dietOn: true, checkedAt: NOW }), NOW);
    expect(v.title).toBe("1 recall matches your diet profile");
    expect(v.tone).toBe("critical");
    expect(JSON.stringify(v)).not.toMatch(/peanut|milk|allerg|halal|kosher|vegan|gluten/i);
    expect(v.rows[0]).toMatchObject({ text: "Granola Bars", label: "Serious", uri: "recalltracker://alert/x" });
  });
  it("counts things that need a look and points to the rest", () => {
    const alerts = ["1", "2", "3", "4", "5"].map((id) => alert(id));
    const v = widgetView(buildSnapshot({ alerts, watching: 5, dietOn: false, checkedAt: NOW }), NOW);
    expect(v.title).toBe("5 things need a look");
    expect(v.rows).toHaveLength(3);
    expect(v.subtitle).toBe("2 more in the app");
    expect(v.uri).toBe("recalltracker://alerts");
  });
  it("says when a background refresh failed", () => {
    const v = widgetView(snap({ checkedAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString() }), NOW, { refreshFailed: true });
    expect(v.footer).toBe("Couldn't refresh · Checked 3 h ago");
  });
  it("formats age without locale surprises", () => {
    expect(ago(new Date(NOW.getTime() - 30_000).toISOString(), NOW)).toBe("just now");
    expect(ago(new Date(NOW.getTime() - 15 * 60_000).toISOString(), NOW)).toBe("15 min ago");
    expect(ago(new Date(NOW.getTime() - 26 * 3600_000).toISOString(), NOW)).toBe("yesterday");
    expect(ago(new Date(NOW.getTime() - 4 * 86_400_000).toISOString(), NOW)).toBe("4 days ago");
  });
});
