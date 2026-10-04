import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { sha256 } from "../lib/crypto.js";
import { matchRecalls } from "../matching/engine.js";
import { resetDb } from "../test/db.js";
import { sendDigests } from "./digest.js";
import { sendPushForAlerts } from "./push.js";

/** Fake Expo client that records what would have been sent. */
function fakeExpo() {
  const sent: Array<{ to: string; title?: string; body?: string }> = [];
  return {
    sent,
    client: {
      sendPushNotificationsAsync: async (msgs: Array<{ to: string | string[]; title?: string; body?: string }>) => {
        for (const m of msgs) sent.push({ to: String(m.to), title: m.title, body: m.body });
        return msgs.map((_m, i) => ({ status: "ok" as const, id: `ticket-${sent.length}-${i}` }));
      },
    },
  };
}

describe("push delivery with preferences and digests", () => {
  beforeAll(async () => {
    await resetDb();
    await ingestSource("FDA", { now: new Date("2026-10-04T12:00:00Z") });
    await ingestSource("FSIS", { now: new Date("2026-10-04T12:00:00Z") });
  });
  afterAll(async () => prisma.$disconnect());

  it("sends to enabled devices, skips muted/low-severity alerts, and marks them handled", async () => {
    const user = await prisma.user.create({
      data: { installId: "n1", tokenHash: sha256("n1"), pushMinSeverity: "high", mutedCategories: ["veterinary"], devices: { create: { expoPushToken: "ExponentPushToken[aaa]", platform: "ios" } } },
    });
    await prisma.watchItem.createMany({
      data: [
        { userId: user.id, kind: "product", label: "Jif", terms: ["jif"] }, // critical food → sent
        { userId: user.id, kind: "product", label: "Pecans", terms: ["pecans"] }, // low → below min severity
        { userId: user.id, kind: "product", label: "Dog food", terms: ["prairie paws"] }, // veterinary → muted
      ],
    });
    const recalls = await prisma.recall.findMany({ where: { sourceId: { in: ["F-1456-2026", "F-1399-2026", "F-1471-2026"] } } });
    expect(await matchRecalls(recalls, { notify: false })).toBe(3);
    const ids = (await prisma.alert.findMany({ where: { userId: user.id }, select: { id: true } })).map((a) => a.id);
    const fake = fakeExpo();
    const result = await sendPushForAlerts(ids, fake.client);
    expect(result.sent).toBe(1);
    expect(fake.sent[0]!.title).toMatch(/Recall · Jif/);
    expect(fake.sent[0]!.body).toContain("Jif");
    const alerts = await prisma.alert.findMany({ where: { userId: user.id }, include: { recall: true } });
    expect(alerts.every((a) => a.pushedAt)).toBe(true);
    expect(alerts.find((a) => a.recall.sourceId === "F-1399-2026")?.pushTicket).toBe("skipped:below_min_severity");
    expect(alerts.find((a) => a.recall.sourceId === "F-1471-2026")?.pushTicket).toBe("skipped:muted_category");
    // Re-sending is a no-op.
    expect((await sendPushForAlerts(ids, fake.client)).sent).toBe(0);
  });

  it("holds non-critical alerts for the daily digest and sends one summary at the user's hour", async () => {
    const user = await prisma.user.create({
      data: { installId: "n2", tokenHash: sha256("n2"), digestMode: true, digestHour: 9, timezone: "America/New_York", devices: { create: { expoPushToken: "ExponentPushToken[bbb]", platform: "ios" } } },
    });
    await prisma.watchItem.createMany({
      data: [
        { userId: user.id, kind: "product", label: "Green juice", terms: ["green juice"] }, // high → digest
        { userId: user.id, kind: "product", label: "Liverwurst", terms: ["liverwurst"] }, // critical → immediate
      ],
    });
    const recalls = await prisma.recall.findMany({ where: { sourceId: { in: ["F-1460-2026", "031-2026"] } } });
    await matchRecalls(recalls, { notify: false });
    const ids = (await prisma.alert.findMany({ where: { userId: user.id }, select: { id: true } })).map((a) => a.id);
    const fake = fakeExpo();
    expect((await sendPushForAlerts(ids, fake.client)).sent).toBe(1); // only the critical one
    expect(fake.sent[0]!.title).toContain("Liverwurst");
    expect(await prisma.alert.count({ where: { userId: user.id, pushedAt: null } })).toBe(1);

    // 13:00Z is 09:00 in New York (EDT): digest goes out. 10:00Z (06:00 local) does not.
    const digestFake = fakeExpo();
    expect(await sendDigests(digestFake.client, new Date("2026-10-04T10:00:00Z"))).toEqual({ users: 0, alerts: 0 });
    expect(await sendDigests(digestFake.client, new Date("2026-10-04T13:00:00Z"))).toEqual({ users: 1, alerts: 1 });
    expect(digestFake.sent[0]!.title).toBe("Your daily recall digest");
    expect(digestFake.sent[0]!.body).toContain("1 new recall");
    expect(await prisma.alert.count({ where: { userId: user.id, pushedAt: null } })).toBe(0);
    // Not again within 20h.
    expect(await sendDigests(digestFake.client, new Date("2026-10-04T13:30:00Z"))).toEqual({ users: 0, alerts: 0 });
  });

  it("never pushes dismissed alerts", async () => {
    const user = await prisma.user.create({ data: { installId: "n3", tokenHash: sha256("n3"), devices: { create: { expoPushToken: "ExponentPushToken[ccc]", platform: "android" } } } });
    await prisma.watchItem.create({ data: { userId: user.id, kind: "product", label: "Metformin", terms: ["metformin"] } });
    const recalls = await prisma.recall.findMany({ where: { sourceId: "D-0211-2026" } });
    await matchRecalls(recalls, { notify: false });
    const alert = await prisma.alert.findFirstOrThrow({ where: { userId: user.id } });
    await prisma.alert.update({ where: { id: alert.id }, data: { dismissedAt: new Date(), dismissReason: "dont_have" } });
    const fake = fakeExpo();
    expect((await sendPushForAlerts([alert.id], fake.client)).sent).toBe(0);
  });
});
