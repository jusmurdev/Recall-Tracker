/**
 * Populate the catalog around a point from health-department open data so the map shows
 * every graded restaurant nearby, not only the ones users added. Results are cached per
 * ~1 km cell for DISCOVERY_TTL_DAYS so repeated map pans don't hammer the open-data APIs.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { restaurantKey } from "../premium/restaurantResearch.js";
import { defaultAdapters } from "./sync.js";
import type { DiscoveredVenue, InspectionAdapter } from "./types.js";

const DISCOVERY_TTL_DAYS = 7;

export function cellKey(lat: number, lng: number): string {
  return `${(Math.round(lat * 100) / 100).toFixed(2)},${(Math.round(lng * 100) / 100).toFixed(2)}`;
}

export interface DiscoveryResult {
  source: string | null;
  fetched: number;
  created: number;
  updated: number;
  cached: boolean;
}

export async function discoverAround(lat: number, lng: number, radiusKm: number, opts: { adapters?: InspectionAdapter[]; now?: Date; force?: boolean } = {}): Promise<DiscoveryResult> {
  const now = opts.now ?? new Date();
  const adapter = (opts.adapters ?? defaultAdapters()).find((a) => a.coversPoint(lat, lng));
  if (!adapter) return { source: null, fetched: 0, created: 0, updated: 0, cached: false };
  const key = `${adapter.source}:${cellKey(lat, lng)}:${Math.ceil(radiusKm)}`;
  const cell = await prisma.discoveryCell.findUnique({ where: { key } });
  if (cell && !opts.force && now.getTime() - cell.fetchedAt.getTime() < DISCOVERY_TTL_DAYS * 86_400_000) {
    return { source: adapter.source, fetched: cell.venues, created: 0, updated: 0, cached: true };
  }
  let venues: DiscoveredVenue[];
  try {
    venues = await adapter.discover(lat, lng, radiusKm);
  } catch (err) {
    logger.warn({ source: adapter.source, err: err instanceof Error ? err.message : String(err) }, "discovery failed");
    throw err;
  }
  let created = 0;
  let updated = 0;
  for (const v of venues) {
    const existing = (await prisma.restaurantProfile.findFirst({ where: { gradeSource: v.source, gradeExternalId: v.externalId } })) ?? (await prisma.restaurantProfile.findUnique({ where: { key: restaurantKey({ name: v.name, city: v.city, state: v.state }) } }));
    const gradeData = v.latest
      ? { gradeSource: v.source, gradeExternalId: v.externalId, currentGrade: v.latest.grade, currentScore: v.latest.score, gradeScale: v.latest.scale, lastInspectedAt: v.latest.inspectedAt, gradeCheckedAt: now, gradeError: null }
      : { gradeSource: v.source, gradeExternalId: v.externalId, gradeCheckedAt: now };
    if (existing) {
      // Never regress a user-pinned location or a fresher grade.
      const fresher = !existing.lastInspectedAt || (v.latest && v.latest.inspectedAt >= existing.lastInspectedAt);
      await prisma.restaurantProfile.update({
        where: { id: existing.id },
        data: { ...(fresher ? gradeData : { gradeCheckedAt: now }), ...(existing.latitude == null ? { latitude: v.latitude, longitude: v.longitude } : {}), ...(existing.address ? {} : { address: v.address }) },
      });
      if (v.latest) await upsertInspection(existing.id, v);
      updated += 1;
    } else {
      const profile = await prisma.restaurantProfile.create({
        data: { key: restaurantKey({ name: v.name, city: v.city, state: v.state }), name: v.name, city: v.city, state: v.state, address: v.address, latitude: v.latitude, longitude: v.longitude, ...gradeData },
      });
      if (v.latest) await upsertInspection(profile.id, v);
      created += 1;
    }
  }
  await prisma.discoveryCell.upsert({ where: { key }, create: { key, source: adapter.source, fetchedAt: now, venues: venues.length }, update: { fetchedAt: now, venues: venues.length } });
  logger.info({ source: adapter.source, lat, lng, radiusKm, fetched: venues.length, created, updated }, "discovery");
  return { source: adapter.source, fetched: venues.length, created, updated, cached: false };
}

async function upsertInspection(profileId: string, v: DiscoveredVenue): Promise<void> {
  const r = v.latest!;
  await prisma.restaurantInspection.upsert({
    where: { profileId_source_inspectedAt: { profileId, source: r.source, inspectedAt: r.inspectedAt } },
    create: { profileId, source: r.source, inspectedAt: r.inspectedAt, grade: r.grade, score: r.score, inspectionType: r.inspectionType, violations: r.violations as unknown as Prisma.InputJsonValue, sourceUrl: r.sourceUrl },
    update: { grade: r.grade, score: r.score },
  });
}
