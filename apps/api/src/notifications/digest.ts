import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { localHour } from "./prefs.js";

let expo: Expo | null = null;
function client(): Expo {
  if (!expo) expo = new Expo({ accessToken: env().EXPO_ACCESS_TOKEN });
  return expo;
}

/**
 * Daily digest: for users in digest mode whose local hour equals their digestHour and who
 * have not had a digest in the last 20h, send one push summarising every un-pushed alert.
 * Runs hourly from the worker.
 */
export async function sendDigests(expoClient: Pick<Expo, "sendPushNotificationsAsync"> = client(), now = new Date()): Promise<{ users: number; alerts: number }> {
  const cutoff = new Date(now.getTime() - 20 * 3600_000);
  const users = await prisma.user.findMany({
    where: { digestMode: true, OR: [{ lastDigestAt: null }, { lastDigestAt: { lt: cutoff } }] },
    include: { devices: { where: { enabled: true, invalidatedAt: null } } },
  });
  let sentUsers = 0;
  let sentAlerts = 0;
  const messages: Array<ExpoPushMessage & { userId: string; alertIds: string[] }> = [];
  for (const user of users) {
    if (localHour(user, now) !== user.digestHour) continue;
    const pending = await prisma.alert.findMany({
      where: { userId: user.id, pushedAt: null, dismissedAt: null, recall: { category: { notIn: user.mutedCategories } } },
      include: { recall: { select: { title: true, severity: true } }, watchItem: { select: { label: true } } },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    });
    if (!pending.length) {
      await prisma.user.update({ where: { id: user.id }, data: { lastDigestAt: now } });
      continue;
    }
    const critical = pending.filter((a) => a.recall.severity === "critical").length;
    const top = pending.slice(0, 3).map((a) => (a.watchItem ? `${a.watchItem.label}: ` : "") + a.recall.title);
    const body = `${pending.length} new recall${pending.length > 1 ? "s" : ""}${critical ? ` (${critical} critical)` : ""} match what you watch. ${top.join(" · ")}`.slice(0, 230);
    for (const device of user.devices) {
      if (!Expo.isExpoPushToken(device.expoPushToken)) continue;
      messages.push({ to: device.expoPushToken, title: "Your daily recall digest", body, data: { url: "recalltracker://alerts" }, channelId: "recalls", userId: user.id, alertIds: pending.map((a) => a.id) });
    }
    if (!user.devices.length) {
      // No device to reach: still mark delivered so the inbox is the record.
      await prisma.$transaction([
        prisma.alert.updateMany({ where: { id: { in: pending.map((a) => a.id) } }, data: { pushedAt: now, pushTicket: "digest:nodevice" } }),
        prisma.user.update({ where: { id: user.id }, data: { lastDigestAt: now } }),
      ]);
    }
  }
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const tickets = await expoClient.sendPushNotificationsAsync(chunk.map(({ userId: _u, alertIds: _a, ...m }) => m));
    for (let j = 0; j < tickets.length; j += 1) {
      const t = tickets[j]!;
      const m = chunk[j]!;
      if (t.status !== "ok") logger.warn({ error: t.details?.error, message: t.message }, "digest push ticket error");
      await prisma.$transaction([
        prisma.alert.updateMany({ where: { id: { in: m.alertIds }, pushedAt: null }, data: { pushedAt: now, pushTicket: t.status === "ok" ? t.id : "digest:error" } }),
        prisma.user.update({ where: { id: m.userId }, data: { lastDigestAt: now } }),
      ]);
      sentUsers += 1;
      sentAlerts += m.alertIds.length;
    }
  }
  logger.info({ users: sentUsers, alerts: sentAlerts }, "digests sent");
  return { users: sentUsers, alerts: sentAlerts };
}
