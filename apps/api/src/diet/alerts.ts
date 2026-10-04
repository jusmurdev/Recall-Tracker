/**
 * Diet alerts: recalls that matter because of what someone avoids, not what they bought.
 * Runs for every changed recall (Direction A) and when a user changes their profile (backfill).
 */
import type { Recall, User } from "@prisma/client";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { enqueuePushForAlerts } from "../jobs/queues.js";
import { ENTRIES } from "./dictionary.js";
import { hasDietSelection, matchRecallForDiet, type RecallDietHit } from "./match.js";

type DietUser = Pick<User, "id" | "dietProfiles" | "otherAllergens">;

/** Days of recalls to look back when a profile is created or changed. */
const BACKFILL_DAYS = 45;
const BACKFILL_LIMIT = 25;

type DietAlertRow = ReturnType<typeof alertData> & { pushedAt?: Date };

/**
 * Create diet alerts; where the user already has an alert for the recall (a category
 * subscription, a brand match), replace it when the diet hit says more. "Undeclared peanuts, you
 * listed peanut allergy" beats "in a category you follow". Returns rows created or upgraded.
 */
async function writeDietAlerts(rows: DietAlertRow[]): Promise<{ created: number; upgraded: number; touched: Array<{ userId: string; recallId: string }> }> {
  if (!rows.length) return { created: 0, upgraded: 0, touched: [] };
  const res = await prisma.alert.createMany({ data: rows, skipDuplicates: true });
  let upgraded = 0;
  if (res.count < rows.length) {
    const existing = await prisma.alert.findMany({
      where: { OR: rows.map((r) => ({ userId: r.userId, recallId: r.recallId })), reason: { not: "diet_match" } },
      select: { id: true, userId: true, recallId: true, score: true },
    });
    for (const e of existing) {
      const row = rows.find((r) => r.userId === e.userId && r.recallId === e.recallId);
      if (!row || row.score <= e.score) continue;
      await prisma.alert.update({ where: { id: e.id }, data: { reason: row.reason, score: row.score, explanation: row.explanation, dietProfile: row.dietProfile, dietKind: row.dietKind, matchedPhrase: row.matchedPhrase, watchItemId: null } });
      upgraded += 1;
    }
  }
  return { created: res.count, upgraded, touched: rows.map((r) => ({ userId: r.userId, recallId: r.recallId })) };
}

function alertData(user: DietUser, recall: Pick<Recall, "id">, hit: RecallDietHit) {
  return {
    userId: user.id,
    recallId: recall.id,
    watchItemId: null,
    reason: "diet_match" as const,
    score: hit.score,
    explanation: hit.explanation,
    dietProfile: hit.profile,
    dietKind: hit.kind,
    matchedPhrase: hit.phrase,
  };
}

/**
 * For each recall, find users whose selection it concerns and create alerts. Cheap: the text is
 * scanned once against the whole dictionary to learn which profiles could fire, then only users
 * holding one of those profiles (or any free-text allergen) are loaded.
 */
export async function matchRecallsForDiet(recalls: Recall[], opts: { notify?: boolean } = {}): Promise<number> {
  const notify = opts.notify ?? true;
  let created = 0;
  const toPush: string[] = [];
  for (const recall of recalls) {
    const probe = matchRecallForDiet(recall, { dietProfiles: ENTRIES.map((e) => e.profile), otherAllergens: [] });
    const profiles = [...new Set(probe.all.filter((h) => h.kind !== "ambiguous").map((h) => h.profile))];
    const users = await prisma.user.findMany({
      where: { OR: [...(profiles.length ? [{ dietProfiles: { hasSome: profiles } }] : []), { NOT: { otherAllergens: { isEmpty: true } } }] },
      select: { id: true, dietProfiles: true, otherAllergens: true },
    });
    if (!users.length) continue;
    const data = [];
    for (const user of users) {
      const { best } = matchRecallForDiet(recall, user);
      if (best) data.push(alertData(user, recall, best));
    }
    if (!data.length) continue;
    const res = await writeDietAlerts(data);
    created += res.created + res.upgraded;
    if (res.created || res.upgraded) {
      const fresh = await prisma.alert.findMany({ where: { recallId: recall.id, reason: "diet_match", userId: { in: data.map((d) => d.userId) }, pushedAt: null, score: { gte: 0.5 } }, select: { id: true } });
      toPush.push(...fresh.map((a) => a.id));
    }
  }
  if (notify && toPush.length) await enqueuePushForAlerts(toPush).catch((err) => logger.error({ err }, "failed to enqueue diet push jobs"));
  return created;
}

/**
 * The user just turned a profile on: show them what is already out there. Alerts are marked
 * pushed (they are looking at the app), so this never buzzes a phone.
 */
export async function backfillDietAlerts(user: DietUser): Promise<number> {
  if (!hasDietSelection(user)) return 0;
  const since = new Date(Date.now() - BACKFILL_DAYS * 86_400_000);
  const recalls = await prisma.recall.findMany({ where: { publishedAt: { gte: since } }, orderBy: { publishedAt: "desc" }, take: 2000 });
  const data = [];
  for (const recall of recalls) {
    const { best } = matchRecallForDiet(recall, user);
    if (best && best.score >= 0.5) data.push({ ...alertData(user, recall, best), pushedAt: new Date() });
    if (data.length >= BACKFILL_LIMIT) break;
  }
  if (!data.length) return 0;
  const res = await writeDietAlerts(data);
  return res.created + res.upgraded;
}

/** Recent recalls that match the user's profile, for the "For my diet" browse filter. */
export async function recallIdsForDiet(user: DietUser, opts: { days?: number; limit?: number } = {}): Promise<Map<string, RecallDietHit>> {
  const out = new Map<string, RecallDietHit>();
  if (!hasDietSelection(user)) return out;
  const since = new Date(Date.now() - (opts.days ?? 365) * 86_400_000);
  const recalls = await prisma.recall.findMany({ where: { publishedAt: { gte: since } }, orderBy: { publishedAt: "desc" }, take: 3000 });
  for (const recall of recalls) {
    const { best } = matchRecallForDiet(recall, user);
    if (best) out.set(recall.id, best);
    if (out.size >= (opts.limit ?? 500)) break;
  }
  return out;
}
