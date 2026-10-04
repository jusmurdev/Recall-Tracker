/** Creates a demo user with a few watch items so the mobile app has data to show. */
import { prisma } from "../db/client.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { findRecallsForItem, recordAlertsForItem } from "../matching/engine.js";

const token = process.env.DEMO_TOKEN ?? randomToken();
const user = await prisma.user.upsert({
  where: { installId: "demo-install" },
  create: { installId: "demo-install", tokenHash: sha256(token), tier: "premium", homeState: "CA" },
  update: { tokenHash: sha256(token), tier: "premium" },
});
await prisma.watchItem.deleteMany({ where: { userId: user.id } });
const items = [
  { kind: "product" as const, label: "Jif peanut butter", terms: ["jif", "peanut butter"] },
  { kind: "product" as const, label: "Boar's Head deli meats", terms: ["boar's head", "liverwurst"] },
  { kind: "upc" as const, label: "Stanley travel mug", terms: ["stanley"], upc: "041604302046" },
  { kind: "product" as const, label: "Dog food (freeze-dried)", terms: ["freeze-dried", "dog food"], categories: ["veterinary" as const] },
];
for (const it of items) {
  const wi = await prisma.watchItem.create({ data: { userId: user.id, ...it } });
  const matches = await findRecallsForItem({ ...wi, homeState: user.homeState });
  await recordAlertsForItem({ ...wi, homeState: user.homeState }, matches);
}
console.log(JSON.stringify({ userId: user.id, token, watchItems: items.length }, null, 2));
await prisma.$disconnect();
