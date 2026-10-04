import { describe, expect, it } from "vitest";
import { decidePush, inQuietHours, localHour, msUntilQuietEnd } from "./prefs.js";

const base = { pushMinSeverity: "unknown" as const, mutedCategories: [], quietHoursStart: null, quietHoursEnd: null, timezone: "America/Chicago", digestMode: false };
const at = (iso: string) => new Date(iso);

describe("notification preferences", () => {
  it("computes local hours per timezone and tolerates bad zones", () => {
    expect(localHour({ timezone: "America/Chicago" }, at("2026-10-04T03:30:00Z"))).toBe(22); // CDT = UTC-5
    expect(localHour({ timezone: "Asia/Tokyo" }, at("2026-10-04T03:30:00Z"))).toBe(12);
    expect(localHour({ timezone: "Not/AZone" }, at("2026-10-04T03:30:00Z"))).toBe(3);
    expect(localHour({ timezone: null }, at("2026-10-04T00:10:00Z"))).toBe(0);
  });

  it("handles quiet-hour windows that wrap midnight", () => {
    const u = { ...base, quietHoursStart: 22, quietHoursEnd: 7 };
    expect(inQuietHours(u, at("2026-10-04T03:30:00Z"))).toBe(true); // 22:30 local
    expect(inQuietHours(u, at("2026-10-04T11:30:00Z"))).toBe(true); // 06:30 local
    expect(inQuietHours(u, at("2026-10-04T13:30:00Z"))).toBe(false); // 08:30 local
    expect(inQuietHours({ ...base, quietHoursStart: 9, quietHoursEnd: 17 }, at("2026-10-04T15:00:00Z"))).toBe(true); // 10:00
    expect(inQuietHours({ ...base, quietHoursStart: 9, quietHoursEnd: 9 }, at("2026-10-04T15:00:00Z"))).toBe(false);
    // 22:30 local → quiet ends 07:00 → 8.5h ahead
    expect(msUntilQuietEnd(u, at("2026-10-04T03:30:00Z"))).toBe(8.5 * 3600_000);
  });

  it("filters, batches, or delays pushes according to preferences", () => {
    const low = { severity: "low" as const, category: "food" as const };
    const critical = { severity: "critical" as const, category: "food" as const };
    expect(decidePush(base, low)).toEqual({ send: true });
    expect(decidePush({ ...base, pushMinSeverity: "high" }, low)).toEqual({ send: false, reason: "below_min_severity" });
    // Undeclared allergens for an allergic user skip the digest.
    expect(decidePush({ ...base, digestMode: true }, { severity: "high", category: "food" })).toEqual({ send: false, reason: "digest" });
    expect(decidePush({ ...base, digestMode: true }, { severity: "high", category: "food" }, { bypassDigest: true })).toEqual({ send: true });
    expect(decidePush({ ...base, pushMinSeverity: "high" }, critical)).toEqual({ send: true });
    expect(decidePush({ ...base, mutedCategories: ["food"] }, critical)).toEqual({ send: false, reason: "muted_category" });
    expect(decidePush({ ...base, digestMode: true }, low)).toEqual({ send: false, reason: "digest" });
    expect(decidePush({ ...base, digestMode: true }, critical)).toEqual({ send: true }); // critical never waits
    const quiet = { ...base, quietHoursStart: 22, quietHoursEnd: 7 };
    const d = decidePush(quiet, low, {}, at("2026-10-04T03:30:00Z"));
    expect(d).toMatchObject({ send: false, reason: "quiet_hours" });
    expect((d as { delayMs: number }).delayMs).toBe(8.5 * 3600_000);
    expect(decidePush(quiet, critical, {}, at("2026-10-04T03:30:00Z"))).toEqual({ send: true });
  });
});
