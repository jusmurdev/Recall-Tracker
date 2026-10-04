import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { enqueueReceipts } from "../jobs/queues.js";

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
    where: { id: { in: alertIds }, pushedAt: null },
    include: {
      recall: { select: { title: true, severity: true, category: true, company: true } },
      watchItem: { select: { label: true } },
      user: { include: { devices: { where: { enabled: true, invalidatedAt: null } } } },
    },
  });

  const messages: Array<ExpoPushMessage & { alertId: string; deviceId: string }> = [];
  let skipped = 0;
  for (const alert of alerts) {
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
        sound: alert.recall.severity === "critical" ? "default" : undefined,
        priority: alert.recall.severity === "critical" ? "high" : "default",
        title: `${SEVERITY_PREFIX[alert.recall.severity] ?? "Recall"}${alert.watchItem ? ` · ${alert.watchItem.label}` : ""}`,
        body: truncate(`${alert.recall.title}. ${alert.explanation}`, 170),
        data: { alertId: alert.id, recallId: alert.recallId, url: `recalltracker://alerts/${alert.id}` },
        channelId: alert.recall.severity === "critical" ? "critical-recalls" : "recalls",
        categoryId: "recall",
        alertId: alert.id,
        deviceId: device.id,
      });
    }
  }
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
