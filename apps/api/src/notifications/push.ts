import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { enqueuePushForAlerts, enqueuePushForNotices, enqueueReceipts } from "../jobs/queues.js";
import { decidePush, inQuietHours, msUntilQuietEnd } from "./prefs.js";

let expo: Expo | null = null;
function client(): Expo {
  if (!expo) expo = new Expo({ accessToken: env().EXPO_ACCESS_TOKEN });
  return expo;
}

const SEVERITY_PREFIX: Record<string, string> = {
  critical: "🚨 Recall",
  high: "⚠️ Recall",
  low: "ℹ️ Recall",
  unknown: "Recall",
};

export interface PushResult {
  sent: number;
  skipped: number;
  invalidated: number;
}

/**
 * Deliver push notifications for the given alerts to every enabled device of each user.
 * Marks alerts pushed, records tickets, and schedules a receipt check.
 */
export async function sendPushForAlerts(alertIds: string[], expoClient: Pick<Expo, "sendPushNotificationsAsync"> = client()): Promise<PushResult> {
  const alerts = await prisma.alert.findMany({
    where: { id: { in: alertIds }, pushedAt: null, dismissedAt: null },
    include: {
      recall: { select: { title: true, severity: true, category: true, company: true } },
      watchItem: { select: { label: true } },
      user: { include: { devices: { where: { enabled: true, invalidatedAt: null } } } },
    },
  });

  const messages: Array<ExpoPushMessage & { alertId: string; deviceId: string }> = [];
  let skipped = 0;
  const delayed = new Map<number, string[]>();
  for (const alert of alerts) {
    // Respect the user's notification preferences. An undeclared allergen for someone with that
    // allergy is always at least "high" and never waits for the digest.
    const urgentDiet = alert.reason === "diet_match" && alert.dietKind === "undeclared" && !["halal", "kosher", "vegan"].includes(alert.dietProfile ?? "");
    const severity = urgentDiet && (alert.recall.severity === "low" || alert.recall.severity === "unknown") ? "high" : alert.recall.severity;
    const decision = decidePush(alert.user, { ...alert.recall, severity }, { bypassDigest: urgentDiet });
    if (!decision.send) {
      if (decision.reason === "quiet_hours") {
        const bucket = Math.ceil(decision.delayMs / 60_000) * 60_000;
        delayed.set(bucket, [...(delayed.get(bucket) ?? []), alert.id]);
      } else if (decision.reason !== "digest") {
        // Final: mark as handled so it is never retried. Digest alerts stay pushedAt=null for the digest job.
        await prisma.alert.update({ where: { id: alert.id }, data: { pushedAt: new Date(), pushTicket: `skipped:${decision.reason}` } });
      }
      skipped += 1;
      continue;
    }
    if (!alert.user.devices.length) {
      skipped += 1;
      continue;
    }
    for (const device of alert.user.devices) {
      if (!Expo.isExpoPushToken(device.expoPushToken)) {
        skipped += 1;
        continue;
      }
      messages.push({
        to: device.expoPushToken,
        sound: severity === "critical" || urgentDiet ? "default" : undefined,
        priority: severity === "critical" || urgentDiet ? "high" : "default",
        title: alert.reason === "diet_match" ? `${SEVERITY_PREFIX[severity] ?? "Recall"} · ${dietTitle(alert.dietProfile, alert.explanation)}` : `${SEVERITY_PREFIX[severity] ?? "Recall"}${alert.watchItem ? ` · ${alert.watchItem.label}` : ""}`,
        body: truncate(`${alert.recall.title}. ${alert.explanation}`, 170),
        data: { alertId: alert.id, recallId: alert.recallId, url: `recalltracker://alerts/${alert.id}` },
        channelId: severity === "critical" ? "critical-recalls" : "recalls",
        categoryId: "recall",
        alertId: alert.id,
        deviceId: device.id,
      });
    }
  }
  for (const [delayMs, ids] of delayed) await enqueuePushForAlerts(ids, { delayMs });
  if (!messages.length) return { sent: 0, skipped, invalidated: 0 };

  let sent = 0;
  let invalidated = 0;
  const ticketIds: string[] = [];
  const now = new Date();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    let tickets: ExpoPushTicket[];
    try {
      tickets = await expoClient.sendPushNotificationsAsync(chunk.map(({ alertId: _a, deviceId: _d, ...m }) => m));
    } catch (err) {
      logger.error({ err }, "expo push send failed");
      throw err;
    }
    for (let j = 0; j < tickets.length; j += 1) {
      const ticket = tickets[j]!;
      const msg = chunk[j]!;
      if (ticket.status === "ok") {
        sent += 1;
        ticketIds.push(ticket.id);
        await prisma.alert.update({ where: { id: msg.alertId }, data: { pushedAt: now, pushTicket: ticket.id } });
      } else {
        const code = ticket.details?.error;
        logger.warn({ code, message: ticket.message, deviceId: msg.deviceId }, "push ticket error");
        if (code === "DeviceNotRegistered") {
          invalidated += 1;
          await prisma.device.update({ where: { id: msg.deviceId }, data: { enabled: false, invalidatedAt: now } });
        }
        // Mark as pushed anyway so we don't retry forever on a bad token.
        await prisma.alert.update({ where: { id: msg.alertId }, data: { pushedAt: now } });
      }
    }
  }
  await enqueueReceipts(ticketIds);
  return { sent, skipped, invalidated };
}

/** Second phase: ask Expo whether the provider (APNs/FCM) accepted each message. */
export async function checkReceipts(ticketIds: string[], expoClient: Pick<Expo, "getPushNotificationReceiptsAsync"> = client()): Promise<void> {
  for (let i = 0; i < ticketIds.length; i += 300) {
    const receipts = await expoClient.getPushNotificationReceiptsAsync(ticketIds.slice(i, i + 300));
    for (const [id, receipt] of Object.entries(receipts)) {
      if (receipt.status === "ok") continue;
      logger.warn({ id, message: receipt.message, details: receipt.details }, "push receipt error");
      if (receipt.details?.error === "DeviceNotRegistered") {
        const alert = await prisma.alert.findFirst({ where: { pushTicket: id }, select: { userId: true } });
        if (alert) {
          // We don't know which device the ticket belonged to once Expo resolves it, so disable
          // the user's devices that have not been seen since the push went out.
          await prisma.device.updateMany({
            where: { userId: alert.userId, lastSeenAt: { lt: new Date(Date.now() - 20 * 60_000) } },
            data: { enabled: false, invalidatedAt: new Date() },
          });
        }
      }
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Push restaurant notices (grade drops etc.) to their users. Honors quiet hours (delay) but not
 * severity/category filters, which are about recalls. Digest mode does not batch these: a grade
 * drop at a place you eat is time-sensitive.
 */
export async function sendPushForNotices(noticeIds: string[], expoClient: Pick<Expo, "sendPushNotificationsAsync"> = client()): Promise<PushResult> {
  const notices = await prisma.restaurantNotice.findMany({
    where: { id: { in: noticeIds }, pushedAt: null },
    include: { user: { include: { devices: { where: { enabled: true, invalidatedAt: null } } } }, profile: { select: { name: true } } },
  });
  const messages: Array<ExpoPushMessage & { noticeId: string; deviceId: string }> = [];
  const delayed = new Map<number, string[]>();
  let skipped = 0;
  const now = new Date();
  for (const n of notices) {
    if (inQuietHours(n.user, now)) {
      const bucket = Math.ceil(msUntilQuietEnd(n.user, now) / 60_000) * 60_000;
      delayed.set(bucket, [...(delayed.get(bucket) ?? []), n.id]);
      skipped += 1;
      continue;
    }
    if (!n.user.devices.length) {
      await prisma.restaurantNotice.update({ where: { id: n.id }, data: { pushedAt: now } });
      skipped += 1;
      continue;
    }
    for (const device of n.user.devices) {
      if (!Expo.isExpoPushToken(device.expoPushToken)) continue;
      messages.push({ to: device.expoPushToken, title: n.title, body: n.body, data: { noticeId: n.id, url: `recalltracker://restaurant-updates` }, channelId: "recalls", noticeId: n.id, deviceId: device.id });
    }
  }
  for (const [delayMs, ids] of delayed) await enqueuePushForNotices(ids, { delayMs });
  let sent = 0;
  let invalidated = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const tickets = await expoClient.sendPushNotificationsAsync(chunk.map(({ noticeId: _n, deviceId: _d, ...m }) => m));
    for (let j = 0; j < tickets.length; j += 1) {
      const t = tickets[j]!;
      const m = chunk[j]!;
      if (t.status === "ok") sent += 1;
      else if (t.details?.error === "DeviceNotRegistered") {
        invalidated += 1;
        await prisma.device.update({ where: { id: m.deviceId }, data: { enabled: false, invalidatedAt: now } });
      }
      await prisma.restaurantNotice.update({ where: { id: m.noticeId }, data: { pushedAt: now } });
    }
  }
  return { sent, skipped, invalidated };
}

/** "Peanut allergy", "Halal diet": the profile name, without exposing anything else. */
function dietTitle(profile: string | null, explanation: string): string {
  if (!profile) return "For your diet";
  const labels: Record<string, string> = {
    allergy_milk: "Milk allergy", allergy_egg: "Egg allergy", allergy_fish: "Fish allergy", allergy_shellfish: "Shellfish allergy", allergy_tree_nut: "Tree nut allergy",
    allergy_peanut: "Peanut allergy", allergy_wheat: "Wheat allergy", allergy_soy: "Soy allergy", allergy_sesame: "Sesame allergy", gluten_free: "Gluten-free", halal: "Halal diet", kosher: "Kosher", vegan: "Vegan",
  };
  if (profile === "allergy_other") {
    const m = explanation.match(/You listed ([a-z' -]+) allergy/i);
    return m ? `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} allergy` : "Your allergy";
  }
  return labels[profile] ?? "For your diet";
}
