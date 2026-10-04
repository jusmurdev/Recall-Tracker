import type { Recall, User } from "@prisma/client";

const RANK: Record<Recall["severity"], number> = { unknown: 0, low: 1, high: 2, critical: 3 };

export type PushDecision = { send: true } | { send: false; reason: "below_min_severity" | "muted_category" | "digest" } | { send: false; reason: "quiet_hours"; delayMs: number };

/** Local hour (0–23) for a user right now, falling back to UTC when the zone is unknown/invalid. */
export function localHour(user: Pick<User, "timezone">, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: user.timezone ?? "UTC" }).formatToParts(now);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    return h === 24 ? 0 : h;
  } catch {
    return now.getUTCHours();
  }
}

export function inQuietHours(user: Pick<User, "timezone" | "quietHoursStart" | "quietHoursEnd">, now = new Date()): boolean {
  if (user.quietHoursStart == null || user.quietHoursEnd == null || user.quietHoursStart === user.quietHoursEnd) return false;
  const h = localHour(user, now);
  const { quietHoursStart: s, quietHoursEnd: e } = user;
  return s < e ? h >= s && h < e : h >= s || h < e; // wraps midnight
}

/** Milliseconds until quiet hours end (to the top of that hour). */
export function msUntilQuietEnd(user: Pick<User, "timezone" | "quietHoursStart" | "quietHoursEnd">, now = new Date()): number {
  const h = localHour(user, now);
  const end = user.quietHoursEnd ?? 0;
  const hoursAhead = ((end - h + 24) % 24) || 24;
  const minutesIntoHour = now.getUTCMinutes();
  return Math.max(60_000, (hoursAhead * 60 - minutesIntoHour) * 60_000);
}

/**
 * Should this alert be pushed right now? Order matters: muted/severity filters are final,
 * digest batching is next, quiet hours only delay.
 */
export function decidePush(
  user: Pick<User, "pushMinSeverity" | "mutedCategories" | "quietHoursStart" | "quietHoursEnd" | "timezone" | "digestMode">,
  recall: Pick<Recall, "severity" | "category">,
  opts: { bypassDigest?: boolean } = {},
  now = new Date(),
): PushDecision {
  if (RANK[recall.severity] < RANK[user.pushMinSeverity]) return { send: false, reason: "below_min_severity" };
  if (user.mutedCategories.includes(recall.category)) return { send: false, reason: "muted_category" };
  // Critical recalls always go out immediately; everything else can wait for the digest.
  if (user.digestMode && recall.severity !== "critical" && !opts.bypassDigest) return { send: false, reason: "digest" };
  if (inQuietHours(user, now) && recall.severity !== "critical") return { send: false, reason: "quiet_hours", delayMs: msUntilQuietEnd(user, now) };
  return { send: true };
}
