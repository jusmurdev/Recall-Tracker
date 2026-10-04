/**
 * Public restaurant map. Health grades are public data, so looking at the map is free; the
 * premium part is tracking (supplier research, arrival alerts). The map pulls graded venues
 * from open data around the user into the shared catalog on demand.
 */
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { discoverAround } from "../../inspections/discover.js";
import { gradeOf, safetyRating } from "../../inspections/grade.js";
import { findRecallsForItem } from "../../matching/engine.js";
import { HttpProblem, requireUser } from "../plugins/auth.js";
import { serializeRecall } from "../serialize.js";

/** "true"/"1" → true, "false"/"0" → false (z.coerce.boolean would make "false" true). */
const boolParam = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

async function activeRecallsFor(userId: string, p: { id: string; name: string; supplierTerms: string[] }): Promise<number> {
  if (!p.supplierTerms.length) return 0;
  return (await findRecallsForItem({ id: p.id, userId, kind: "restaurant", label: p.name, terms: p.supplierTerms, upc: null, categories: [], homeState: null }, { limit: 20 })).length;
}

export async function restaurantRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/restaurants/map", async (req) => {
    const user = requireUser(req);
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(0.2).max(25).default(2),
        limit: z.coerce.number().int().min(1).max(200).default(80),
        /** Pull from open data when the area is covered (default on). */
        discover: boolParam.default("true"),
      })
      .parse(req.query);

    let discovery = { source: null as string | null, fetched: 0, cached: false };
    if (q.discover) {
      try {
        const d = await discoverAround(q.lat, q.lng, Math.min(q.radiusKm, 5));
        discovery = { source: d.source, fetched: d.fetched, cached: d.cached };
      } catch {
        // Open data down: still serve what the catalog has.
      }
    }

    const latDelta = q.radiusKm / 111;
    const lngDelta = q.radiusKm / (111 * Math.max(0.2, Math.cos((q.lat * Math.PI) / 180)));
    const rows = await prisma.$queryRaw<Array<{ id: string; distance_km: number }>>(Prisma.sql`
      SELECT id,
        6371 * acos(least(1, cos(radians(${q.lat})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${q.lng})) + sin(radians(${q.lat})) * sin(radians(latitude)))) AS distance_km
      FROM "RestaurantProfile"
      WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN ${q.lat - latDelta} AND ${q.lat + latDelta}
        AND longitude BETWEEN ${q.lng - lngDelta} AND ${q.lng + lngDelta}
      ORDER BY distance_km ASC
      LIMIT ${q.limit * 2}
    `);
    const within = rows.filter((r) => r.distance_km <= q.radiusKm).slice(0, q.limit);
    const profiles = within.length
      ? await prisma.restaurantProfile.findMany({ where: { id: { in: within.map((r) => r.id) } }, include: { _count: { select: { watchItems: true } }, watchItems: { where: { userId: user.id }, select: { id: true } } } })
      : [];
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const items = [];
    for (const r of within) {
      const p = byId.get(r.id);
      if (!p) continue;
      const active = await activeRecallsFor(user.id, p);
      const risk = ((p.researchJson as { riskSignals?: unknown[] } | null)?.riskSignals ?? []).length;
      items.push({
        profileId: p.id, name: p.name, address: p.address, city: p.city, state: p.state, latitude: p.latitude!, longitude: p.longitude!,
        distanceKm: Math.round(r.distance_km * 100) / 100,
        grade: gradeOf(p), rating: safetyRating(p, active, risk), activeRecalls: active, trackedBy: p._count.watchItems, watchItemId: p.watchItems[0]?.id ?? null,
      });
    }
    return { items, discovery, center: { latitude: q.lat, longitude: q.lng }, radiusKm: q.radiusKm };
  });

  /** Public page for any catalog restaurant: grade, inspections, recall exposure. Research stays premium. */
  app.get("/v1/restaurants/:profileId", async (req) => {
    const user = requireUser(req);
    const { profileId } = req.params as { profileId: string };
    const p = await prisma.restaurantProfile.findUnique({ where: { id: profileId }, include: { _count: { select: { watchItems: true } }, watchItems: { where: { userId: user.id }, select: { id: true } }, inspections: { orderBy: { inspectedAt: "desc" }, take: 10 } } });
    if (!p) throw new HttpProblem(404, "not_found", "Restaurant not found");
    const matches = p.supplierTerms.length ? await findRecallsForItem({ id: p.id, userId: user.id, kind: "restaurant", label: p.name, terms: p.supplierTerms, upc: null, categories: [], homeState: null }, { limit: 10 }) : [];
    const risk = ((p.researchJson as { riskSignals?: unknown[] } | null)?.riskSignals ?? []).length;
    return {
      profileId: p.id, name: p.name, address: p.address, city: p.city, state: p.state, website: p.website, latitude: p.latitude, longitude: p.longitude,
      grade: gradeOf(p), rating: safetyRating(p, matches.length, risk),
      inspections: p.inspections.map((i) => ({ id: i.id, inspectedAt: i.inspectedAt.toISOString(), grade: i.grade, score: i.score, inspectionType: i.inspectionType, violations: i.violations as unknown as Array<{ code: string | null; description: string; critical: boolean }>, source: i.source, sourceUrl: i.sourceUrl })),
      activeRecalls: matches.length,
      matchedRecalls: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
      trackedBy: p._count.watchItems, watchItemId: p.watchItems[0]?.id ?? null, researched: p.researchStatus === "ready",
    };
  });
}
