/**
 * Home screen widgets read a small snapshot the app saves whenever alerts load, and refresh it in
 * the background when they can. This file is platform-neutral and has no React Native imports, so
 * the rules below are unit-tested and an iOS widget can reuse them.
 *
 * Rules a widget must follow:
 * - Never say "all clear" without data, or from data too old to trust (see EXPIRED_AFTER_MS).
 * - Never show which diet or allergy matched: a home screen is visible to anyone nearby. Diet
 *   matches read "matches your diet profile", and rows show the product only.
 */
import type { Alert, RecallSeverity } from "@recall/shared";
import { headline } from "@/lib/friendly";

export const SNAPSHOT_VERSION = 1;
/** After this, an "all clear" is no longer stated; the widget asks for a refresh instead. */
export const EXPIRED_AFTER_MS = 48 * 3600_000;
/** After this, the footer says the data is old and the widget tries to refresh on its next update. */
export const STALE_AFTER_MS = 6 * 3600_000;
export const MAX_ROWS = 3;

export interface WidgetAlertRow {
  id: string;
  headline: string;
  severity: RecallSeverity;
  diet: boolean;
}

export interface WidgetSnapshot {
  version: typeof SNAPSHOT_VERSION;
  /** When the alerts behind this snapshot were fetched (ISO). */
  checkedAt: string;
  openCount: number;
  unreadCount: number;
  /** Open diet matches, counted only while a diet profile is on (same rule as Home). */
  dietCount: number;
  watching: number;
  rows: WidgetAlertRow[];
}

type AlertLike = Pick<Alert, "id" | "reason" | "score" | "readAt" | "resolvedAt" | "dismissedAt"> & {
  recall: Pick<Alert["recall"], "title" | "productDescription" | "source" | "severity"> & { headline?: string };
};

const SEVERITY_RANK: Record<RecallSeverity, number> = { critical: 3, high: 2, low: 1, unknown: 0 };

export function buildSnapshot(input: { alerts: AlertLike[]; watching: number; dietOn: boolean; checkedAt: Date }): WidgetSnapshot {
  const open = input.alerts.filter((a) => !a.resolvedAt && !a.dismissedAt);
  const isDiet = (a: AlertLike) => input.dietOn && a.reason === "diet_match";
  const ordered = [...open].sort(
    (a, b) => Number(isDiet(b)) - Number(isDiet(a)) || SEVERITY_RANK[b.recall.severity] - SEVERITY_RANK[a.recall.severity] || b.score - a.score,
  );
  return {
    version: SNAPSHOT_VERSION,
    checkedAt: input.checkedAt.toISOString(),
    openCount: open.length,
    unreadCount: open.filter((a) => !a.readAt).length,
    dietCount: open.filter(isDiet).length,
    watching: input.watching,
    rows: ordered.slice(0, MAX_ROWS).map((a) => ({ id: a.id, headline: headline(a.recall), severity: a.recall.severity, diet: isDiet(a) })),
  };
}

/** Parse what was stored; anything unexpected is treated as "no snapshot". */
export function parseSnapshot(raw: string | null | undefined): WidgetSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<WidgetSnapshot>;
    if (s.version !== SNAPSHOT_VERSION || typeof s.checkedAt !== "string" || Number.isNaN(Date.parse(s.checkedAt)) || !Array.isArray(s.rows)) return null;
    return s as WidgetSnapshot;
  } catch {
    return null;
  }
}

export type WidgetTone = "critical" | "high" | "clear" | "unknown";

export interface WidgetView {
  tone: WidgetTone;
  title: string;
  subtitle: string;
  rows: Array<{ id: string; text: string; label: string; severity: RecallSeverity; uri: string }>;
  footer: string;
  /** Where tapping the widget body goes. */
  uri: string;
  stale: boolean;
}

export const SEVERITY_WORD: Record<RecallSeverity, string> = { critical: "Serious", high: "Moderate", low: "Minor", unknown: "Unrated" };

/** "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago": no locale or time-zone surprises. */
export function ago(fromIso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - Date.parse(fromIso));
  const min = Math.floor(ms / 60_000);
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function widgetView(snap: WidgetSnapshot | null, now: Date, opts: { refreshFailed?: boolean } = {}): WidgetView {
  if (!snap) {
    return { tone: "unknown", title: "Open Recall Tracker", subtitle: "Open the app once and we'll start checking what you watch.", rows: [], footer: "", uri: "recalltracker://", stale: true };
  }
  const age = now.getTime() - Date.parse(snap.checkedAt);
  const stale = age > STALE_AFTER_MS;
  const footer = `${opts.refreshFailed ? "Couldn't refresh · " : ""}Checked ${ago(snap.checkedAt, now)}`;
  const rows = snap.rows.map((r) => ({ id: r.id, text: r.headline, label: SEVERITY_WORD[r.severity], severity: r.severity, uri: `recalltracker://alert/${r.id}` }));

  if (snap.openCount > 0) {
    const tone: WidgetTone = snap.rows.some((r) => r.severity === "critical") ? "critical" : "high";
    const title = snap.dietCount > 0
      ? `${plural(snap.dietCount, "recall matches", "recalls match")} your diet profile`
      : `${plural(snap.openCount, "thing needs", "things need")} a look`;
    const more = snap.openCount - rows.length;
    const subtitle = more > 0 ? `${more} more in the app` : snap.unreadCount ? `${snap.unreadCount} new` : "Tap one to see what to do";
    return { tone, title, subtitle, rows, footer, uri: "recalltracker://alerts", stale };
  }
  if (age > EXPIRED_AFTER_MS) {
    return { tone: "unknown", title: "Not checked recently", subtitle: "Tap to open the app and check for new recalls.", rows: [], footer, uri: "recalltracker://", stale: true };
  }
  if (snap.watching === 0) {
    return { tone: "unknown", title: "Nothing watched yet", subtitle: "Add a few products you buy and we'll watch them.", rows: [], footer, uri: "recalltracker://watch/new", stale };
  }
  return { tone: "clear", title: "You're all clear", subtitle: `Nothing you watch has been recalled. Watching ${plural(snap.watching, "item", "items")}.`, rows: [], footer, uri: "recalltracker://", stale };
}
