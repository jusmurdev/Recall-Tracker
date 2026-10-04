/**
 * Keep a restaurant's health-inspection grade current and tell everyone tracking it when it
 * changes. Grades live on the shared RestaurantProfile, so they are fetched once per venue,
 * never per user, and survive users removing the restaurant from their watchlist.
 */
import type { Prisma, RestaurantProfile } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { enqueuePushForNotices } from "../jobs/queues.js";
import { fetchJson } from "../lib/http.js";
import { logger } from "../lib/logger.js";
import { inspectionFixtureFetcher } from "./fixtureLoader.js";
import { compareLevels, interpretGrade } from "./grade.js";
import { ChicagoCdphAdapter } from "./sources/chicagoCdph.js";
import { NycDohmhAdapter } from "./sources/nycDohmh.js";
import type { InspectionAdapter, InspectionRecord } from "./types.js";

export function defaultAdapters(): InspectionAdapter[] {
  const fetcher = env().INGEST_USE_FIXTURES ? inspectionFixtureFetcher : <T>(url: string) => fetchJson<T>(url);
  const token = process.env.SOCRATA_APP_TOKEN;
  return [new NycDohmhAdapter(fetcher, token), new ChicagoCdphAdapter(fetcher, token)];
}

export function adapterFor(profile: Pick<RestaurantProfile, "city" | "state">, adapters = defaultAdapters()): InspectionAdapter | null {
  return adapters.find((a) => a.covers(profile)) ?? null;
}

export interface GradeSyncResult {
  profileId: string;
  source: string | null;
  inspectionsStored: number;
  previousGrade: string | null;
  currentGrade: string | null;
  changed: boolean;
  noticesCreated: number;
}

/**
 * Fetch inspections from the jurisdiction's open-data source (or accept records handed in by
 * the AI research fallback), store them, update the profile's current grade, and notify
 * trackers on change.
 */
export async function syncGrade(profileId: string, opts: { adapters?: InspectionAdapter[]; records?: InspectionRecord[]; source?: string } = {}): Promise<GradeSyncResult> {
  const profile = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profileId } });
  const now = new Date();
  let records = opts.records ?? [];
  let source = opts.source ?? null;
  if (!opts.records) {
    const adapter = adapterFor(profile, opts.adapters);
    if (!adapter) {
      await prisma.restaurantProfile.update({ where: { id: profileId }, data: { gradeCheckedAt: now, gradeError: profile.currentGrade ? null : "No inspection data source for this jurisdiction yet." } });
      return { profileId, source: null, inspectionsStored: 0, previousGrade: profile.currentGrade, currentGrade: profile.currentGrade, changed: false, noticesCreated: 0 };
    }
    source = adapter.source;
    try {
      records = await adapter.lookup(profile);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ profileId, source, err: message }, "grade lookup failed");
      await prisma.restaurantProfile.update({ where: { id: profileId }, data: { gradeCheckedAt: now, gradeError: message.slice(0, 300) } });
      throw err;
    }
  }

  let stored = 0;
  for (const r of records) {
    await prisma.restaurantInspection.upsert({
      where: { profileId_source_inspectedAt: { profileId, source: r.source, inspectedAt: r.inspectedAt } },
      create: { profileId, source: r.source, inspectedAt: r.inspectedAt, grade: r.grade, score: r.score, inspectionType: r.inspectionType, violations: r.violations as unknown as Prisma.InputJsonValue, sourceUrl: r.sourceUrl },
      update: { grade: r.grade, score: r.score, inspectionType: r.inspectionType, violations: r.violations as unknown as Prisma.InputJsonValue, sourceUrl: r.sourceUrl },
    });
    stored += 1;
  }

  // Latest graded inspection wins; NYC sometimes leaves grade blank on a re-inspection with a score.
  const latest = [...records].sort((a, b) => b.inspectedAt.getTime() - a.inspectedAt.getTime()).find((r) => r.grade || r.score != null) ?? null;
  const previousGrade = profile.currentGrade;
  const prevLevel = interpretGrade(profile.currentGrade, profile.currentScore, profile.gradeScale).level;
  const updated = await prisma.restaurantProfile.update({
    where: { id: profileId },
    data: {
      gradeCheckedAt: now,
      gradeError: latest ? null : profile.currentGrade ? null : "Not found in the inspection database. Check the name and city.",
      ...(latest
        ? { gradeSource: latest.source, gradeExternalId: latest.externalId ?? profile.gradeExternalId, currentGrade: latest.grade, currentScore: latest.score, gradeScale: latest.scale, lastInspectedAt: latest.inspectedAt }
        : {}),
    },
  });

  const nextLevel = interpretGrade(updated.currentGrade, updated.currentScore, updated.gradeScale).level;
  const changed = !!latest && (previousGrade ?? null) !== (updated.currentGrade ?? null) && !!(previousGrade || updated.currentGrade);
  let noticesCreated = 0;
  if (changed) noticesCreated = await notifyTrackers(updated, previousGrade, prevLevel, nextLevel);
  logger.info({ profileId, source, stored, previousGrade, currentGrade: updated.currentGrade, changed, noticesCreated }, "grade sync");
  return { profileId, source, inspectionsStored: stored, previousGrade, currentGrade: updated.currentGrade, changed, noticesCreated };
}

async function notifyTrackers(profile: RestaurantProfile, previousGrade: string | null, prevLevel: string, nextLevel: string): Promise<number> {
  const trackers = await prisma.watchItem.findMany({ where: { restaurantProfileId: profile.id }, select: { userId: true }, distinct: ["userId"] });
  if (!trackers.length) return 0;
  const direction = compareLevels(prevLevel as never, nextLevel as never);
  const { label } = interpretGrade(profile.currentGrade, profile.currentScore, profile.gradeScale);
  const kind = previousGrade ? "grade_change" : "grade_first";
  const title = previousGrade
    ? `${profile.name}: health grade ${direction === "worse" ? "dropped" : direction === "better" ? "improved" : "changed"} to ${profile.currentGrade}`
    : `${profile.name}: health grade is ${profile.currentGrade}`;
  const body = `${label ?? profile.currentGrade}${previousGrade ? ` (was ${previousGrade})` : ""}${profile.lastInspectedAt ? ` · inspected ${profile.lastInspectedAt.toISOString().slice(0, 10)}` : ""}.`;
  const data = { previousGrade, currentGrade: profile.currentGrade, direction, level: nextLevel, inspectedAt: profile.lastInspectedAt?.toISOString() ?? null };
  const res = await prisma.restaurantNotice.createMany({ data: trackers.map((t) => ({ userId: t.userId, profileId: profile.id, kind, title, body, data })) });
  // Only push when it matters: a drop, a failure, or a first grade that is poor. Improvements stay in-app.
  if (direction === "worse" || (kind === "grade_first" && nextLevel === "poor")) {
    const ids = await prisma.restaurantNotice.findMany({ where: { profileId: profile.id, kind, pushedAt: null, createdAt: { gte: new Date(Date.now() - 60_000) } }, select: { id: true } });
    await enqueuePushForNotices(ids.map((n) => n.id)).catch((err) => logger.error({ err }, "failed to enqueue notice pushes"));
  }
  return res.count;
}
