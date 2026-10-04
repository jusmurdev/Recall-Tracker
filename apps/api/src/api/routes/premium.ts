import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateConnectorRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { env } from "../../config/env.js";
import { encryptSecret } from "../../lib/crypto.js";
import { enqueueResearch } from "../../jobs/queues.js";
import { importPurchases } from "../../premium/purchaseImport.js";
import { PremiumUnavailableError, QuotaExceededError } from "../../premium/claude.js";
import { AiProviderError, AiRefusalError, listProviders } from "../../ai/index.js";
import { canRefresh, isFresh, restaurantKey } from "../../premium/restaurantResearch.js";
import { findRecallsForItem } from "../../matching/engine.js";
import { Prisma } from "@prisma/client";
import { gradeOf, safetyRating } from "../../inspections/grade.js";
import { adapterFor, syncGrade } from "../../inspections/sync.js";
import { enqueueGradeSync } from "../../jobs/queues.js";
import { HttpProblem, requirePremium } from "../plugins/auth.js";
import { serializeConnector, serializeRecall, serializeWatchItem } from "../serialize.js";

/** Known MCP endpoints for providers that publish one. Users can also paste a custom URL. */
export const PROVIDER_PRESETS: Record<string, { label: string; mcpUrl: string | null; docs: string }> = {
  instacart: { label: "Instacart", mcpUrl: null, docs: "https://docs.instacart.com/developer_platform_api/" },
  doordash: { label: "DoorDash", mcpUrl: null, docs: "https://developer.doordash.com/" },
  ubereats: { label: "Uber Eats", mcpUrl: null, docs: "https://developer.uber.com/docs/eats" },
  amazon: { label: "Amazon", mcpUrl: null, docs: "https://developer.amazon.com/" },
  walmart: { label: "Walmart", mcpUrl: null, docs: "https://developer.walmart.com/" },
  kroger: { label: "Kroger", mcpUrl: null, docs: "https://developer.kroger.com/" },
  custom: { label: "Custom MCP server", mcpUrl: null, docs: "https://modelcontextprotocol.io/" },
};

export async function premiumRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/premium/providers", async () => ({
    providers: Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({ id, ...p })),
  }));

  app.get("/v1/premium/connectors", async (req) => {
    const user = requirePremium(req);
    const connectors = await prisma.connector.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return { items: connectors.map(serializeConnector) };
  });

  app.post("/v1/premium/connectors", async (req, reply) => {
    const user = requirePremium(req);
    const body = CreateConnectorRequest.parse(req.body);
    if (!/^https:\/\//.test(body.mcpUrl)) throw new HttpProblem(400, "validation", "MCP server URL must use https.");
    const connector = await prisma.connector.create({
      data: {
        userId: user.id,
        provider: body.provider,
        displayName: body.displayName,
        mcpUrl: body.mcpUrl,
        tokenCiphertext: body.authorizationToken ? encryptSecret(body.authorizationToken) : null,
      },
    });
    return reply.status(201).send(serializeConnector(connector));
  });

  app.delete("/v1/premium/connectors/:id", async (req, reply) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const res = await prisma.connector.deleteMany({ where: { id, userId: user.id } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Connector not found");
    return reply.status(204).send();
  });

  /** Runs synchronously: Claude reads the account through MCP and returns products. */
  app.post("/v1/premium/connectors/:id/import", async (req) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const connector = await prisma.connector.findFirst({ where: { id, userId: user.id } });
    if (!connector) throw new HttpProblem(404, "not_found", "Connector not found");
    try {
      const outcome = await importPurchases(connector, user.id);
      await prisma.connector.update({ where: { id }, data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null } });
      return { connectorId: id, created: outcome.created.map(serializeWatchItem), skippedDuplicates: outcome.skippedDuplicates, summary: outcome.summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.connector.update({ where: { id }, data: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: message.slice(0, 500) } });
      throw translate(err);
    }
  });

  /**
   * Is this restaurant already researched? Lets the app say "ready instantly" before the user
   * commits, and shows how many others track it. Research is shared across all users.
   */
  app.get("/v1/premium/restaurants/lookup", async (req) => {
    requirePremium(req);
    const q = z.object({ name: z.string().trim().min(1), city: z.string().trim().optional(), state: z.string().trim().length(2).optional(), website: z.string().url().optional() }).parse(req.query);
    const profile = await prisma.restaurantProfile.findUnique({ where: { key: restaurantKey(q) }, include: { _count: { select: { watchItems: true } } } });
    if (!profile) return { known: false };
    return {
      known: true,
      profileId: profile.id,
      status: profile.researchStatus,
      fresh: isFresh(profile),
      researchedAt: profile.researchedAt?.toISOString() ?? null,
      trackedBy: profile._count.watchItems,
      summary: isFresh(profile) ? profile.summary : null,
    };
  });

  /**
   * Shared catalog search. Every restaurant anyone has ever added is here with its research
   * status, health grade and how many people track it, so users pick instead of re-describing
   * (and re-researching) the same place. Optional lat/lng ranks nearby matches first.
   */
  app.get("/v1/premium/restaurants/search", async (req) => {
    const user = requirePremium(req);
    const q = z.object({ q: z.string().trim().min(2).max(80), lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), state: z.string().length(2).optional(), limit: z.coerce.number().int().min(1).max(30).default(10) }).parse(req.query);
    const like = `%${q.q.toLowerCase().replace(/[%_\\]/g, "")}%`;
    const rows = await prisma.$queryRaw<Array<{ id: string; sim: number; distance_km: number | null }>>(Prisma.sql`
      SELECT id,
        GREATEST(similarity(lower(name), ${q.q.toLowerCase()}), CASE WHEN lower(name) LIKE ${like} THEN 0.6 ELSE 0 END) AS sim,
        CASE WHEN latitude IS NOT NULL AND ${q.lat ?? null}::float8 IS NOT NULL
             THEN 6371 * acos(least(1, cos(radians(${q.lat ?? 0})) * cos(radians(latitude)) * cos(radians(longitude) - radians(${q.lng ?? 0})) + sin(radians(${q.lat ?? 0})) * sin(radians(latitude))))
             ELSE NULL END AS distance_km
      FROM "RestaurantProfile"
      WHERE (lower(name) LIKE ${like} OR similarity(lower(name), ${q.q.toLowerCase()}) > 0.3)
        AND (${q.state ?? null}::text IS NULL OR state = ${q.state ?? null})
      ORDER BY sim DESC, distance_km ASC NULLS LAST, "lastRequestedAt" DESC
      LIMIT ${q.limit}
    `);
    if (!rows.length) return { items: [] };
    const profiles = await prisma.restaurantProfile.findMany({ where: { id: { in: rows.map((r) => r.id) } }, include: { _count: { select: { watchItems: true } }, watchItems: { where: { userId: user.id }, select: { id: true } } } });
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const items = [];
    for (const r of rows) {
      const p = byId.get(r.id);
      if (!p) continue;
      items.push({
        profileId: p.id, name: p.name, city: p.city, state: p.state, website: p.website, latitude: p.latitude, longitude: p.longitude,
        distanceKm: r.distance_km != null ? Math.round(r.distance_km * 10) / 10 : null,
        trackedBy: p._count.watchItems, researchStatus: p.researchStatus, researchedAt: p.researchedAt?.toISOString() ?? null,
        grade: gradeOf(p),
        activeRecalls: p.supplierTerms.length ? (await findRecallsForItem({ id: p.id, userId: user.id, kind: "restaurant", label: p.name, terms: p.supplierTerms, upc: null, categories: [], homeState: null }, { limit: 50 })).length : 0,
        watchItemId: p.watchItems[0]?.id ?? null,
      });
    }
    return { items };
  });

  /**
   * Known restaurants near a point, with whether their suppliers currently have recalls.
   * Powers "what's around me" and the geofence list. Coordinates come from the phone and are
   * used for this query only; they are not stored.
   */
  app.get("/v1/premium/restaurants/nearby", async (req) => {
    const user = requirePremium(req);
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(0.1).max(50).default(5),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    // Haversine over the indexed bounding box; fine for the volumes a city produces.
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
    if (!within.length) return { items: [] };
    const profiles = await prisma.restaurantProfile.findMany({
      where: { id: { in: within.map((r) => r.id) } },
      include: { _count: { select: { watchItems: true } }, watchItems: { where: { userId: user.id }, select: { id: true } } },
    });
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const items = [];
    for (const r of within) {
      const p = byId.get(r.id);
      if (!p) continue;
      const active = p.supplierTerms.length
        ? (await findRecallsForItem({ id: p.id, userId: user.id, kind: "restaurant", label: p.name, terms: p.supplierTerms, upc: null, categories: [], homeState: null }, { limit: 50 })).length
        : 0;
      items.push({
        profileId: p.id,
        name: p.name,
        city: p.city,
        state: p.state,
        latitude: p.latitude!,
        longitude: p.longitude!,
        distanceKm: Math.round(r.distance_km * 100) / 100,
        trackedBy: p._count.watchItems,
        researchStatus: p.researchStatus,
        summary: p.researchStatus === "ready" ? p.summary : null,
        activeRecalls: active,
        watchItemId: p.watchItems[0]?.id ?? null,
        grade: gradeOf(p),
        rating: safetyRating(p, active),
      });
    }
    return { items };
  });

  /** Updates about restaurants the user tracks: grade changes, closures, research refreshes. */
  app.get("/v1/premium/restaurants/updates", async (req) => {
    const user = requirePremium(req);
    const notices = await prisma.restaurantNotice.findMany({ where: { userId: user.id }, include: { profile: { select: { name: true, watchItems: { where: { userId: user.id }, select: { id: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 });
    const unread = await prisma.restaurantNotice.count({ where: { userId: user.id, readAt: null } });
    return {
      unread,
      items: notices.map((n) => ({ id: n.id, profileId: n.profileId, restaurant: n.profile.name, watchItemId: n.profile.watchItems[0]?.id ?? null, kind: n.kind, title: n.title, body: n.body, data: n.data, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null })),
    };
  });
  app.post("/v1/premium/restaurants/updates/read-all", async (req) => {
    const user = requirePremium(req);
    const res = await prisma.restaurantNotice.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  });

  /** Restaurant research for one of the user's watch items (served from the shared profile). */
  app.get("/v1/premium/restaurants/:id", async (req) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id, kind: "restaurant" }, include: { restaurantProfile: { include: { _count: { select: { watchItems: true } } } } } });
    if (!item) throw new HttpProblem(404, "not_found", "Restaurant not found");
    const profile = item.restaurantProfile;
    const alerts = await prisma.alert.findMany({ where: { watchItemId: id }, include: { recall: true }, orderBy: { createdAt: "desc" }, take: 20 });
    const research = (profile?.researchJson ?? item.researchJson ?? null) as null | { riskSignals?: Array<{ signal: string; sourceUrl: string | null }>; sources?: string[] };
    const ready = profile ? profile.researchStatus === "ready" : !!item.researchUpdatedAt;
    const inspections = profile ? await prisma.restaurantInspection.findMany({ where: { profileId: profile.id }, orderBy: { inspectedAt: "desc" }, take: 10 }) : [];
    const notices = profile ? await prisma.restaurantNotice.findMany({ where: { profileId: profile.id, userId: user.id }, orderBy: { createdAt: "desc" }, take: 10 }) : [];
    const gradeCoverage = profile ? (adapterFor(profile) ? "open_data" : profile.gradeSource === "ai_research" || !profile.currentGrade ? "research" : "open_data") : "none";
    return {
      grade: profile ? gradeOf(profile) : null,
      gradeCoverage,
      gradeError: profile?.gradeError ?? null,
      inspections: inspections.map((i) => ({ id: i.id, inspectedAt: i.inspectedAt.toISOString(), grade: i.grade, score: i.score, inspectionType: i.inspectionType, violations: i.violations as unknown as Array<{ code: string | null; description: string; critical: boolean }>, source: i.source, sourceUrl: i.sourceUrl })),
      updates: notices.map((n) => ({ id: n.id, profileId: n.profileId, restaurant: profile!.name, watchItemId: id, kind: n.kind, title: n.title, body: n.body, data: n.data, createdAt: n.createdAt.toISOString(), readAt: n.readAt?.toISOString() ?? null })),
      watchItemId: item.id,
      restaurant: profile?.name ?? item.restaurantName ?? item.label,
      summary: profile?.summary ?? item.researchSummary ?? "",
      supplierTerms: profile?.supplierTerms ?? item.terms,
      riskSignals: research?.riskSignals ?? [],
      sources: research?.sources ?? [],
      matchedRecalls: alerts.map((a) => ({ recall: serializeRecall(a.recall), reason: a.reason, score: a.score, explanation: a.explanation })),
      researchedAt: (profile?.researchedAt ?? item.researchUpdatedAt)?.toISOString() ?? null,
      status: ready ? "ready" : profile?.researchStatus === "failed" ? "failed" : "pending",
      error: profile?.researchStatus === "failed" ? profile.researchError : null,
      location: profile?.latitude != null && profile.longitude != null ? { latitude: profile.latitude, longitude: profile.longitude } : null,
      shared: profile ? { profileId: profile.id, trackedBy: profile._count.watchItems, researchCount: profile.researchCount, cacheHits: profile.cacheHits, fresh: isFresh(profile), canRefresh: canRefresh(profile) } : null,
    };
  });

  /**
   * Manual refresh. Re-runs the AI only when the shared research is older than
   * RESTAURANT_RESEARCH_MIN_REFRESH_DAYS, so one user cannot burn research for everyone.
   */
  app.post("/v1/premium/restaurants/:id/refresh", async (req, reply) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id, kind: "restaurant" }, include: { restaurantProfile: true } });
    if (!item) throw new HttpProblem(404, "not_found", "Restaurant not found");
    if (!item.restaurantProfile) throw new HttpProblem(409, "no_profile", "This item is not linked to a restaurant profile.");
    const profile = item.restaurantProfile;
    if (!canRefresh(profile)) {
      return reply.status(200).send({
        queued: false,
        reason: profile.researchStatus === "researching" ? "already_researching" : "too_recent",
        researchedAt: profile.researchedAt?.toISOString() ?? null,
        nextRefreshAt: profile.researchedAt ? new Date(profile.researchedAt.getTime() + env().RESTAURANT_RESEARCH_MIN_REFRESH_DAYS * 86_400_000).toISOString() : null,
      });
    }
    const queued = await enqueueResearch({ profileId: profile.id, userId: user.id });
    return reply.status(queued ? 202 : 503).send({ queued, reason: queued ? null : "queue_unavailable" });
  });

  /** Re-check the health grade now (throttled to once per day per restaurant, shared by all trackers). */
  app.post("/v1/premium/restaurants/:id/grade/refresh", async (req, reply) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id, kind: "restaurant" }, include: { restaurantProfile: true } });
    if (!item?.restaurantProfile) throw new HttpProblem(404, "not_found", "Restaurant not found");
    const p = item.restaurantProfile;
    if (p.gradeCheckedAt && Date.now() - p.gradeCheckedAt.getTime() < 24 * 3600_000) {
      return reply.status(200).send({ queued: false, reason: "too_recent", checkedAt: p.gradeCheckedAt.toISOString(), grade: gradeOf(p) });
    }
    if (process.env.DISABLE_QUEUES === "1") {
      // No worker (tests / single-process dev): do it inline.
      const r = await syncGrade(p.id);
      return reply.status(200).send({ queued: false, synced: true, changed: r.changed, grade: gradeOf(await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: p.id } })) });
    }
    const queued = await enqueueGradeSync(p.id);
    return reply.status(202).send({ queued });
  });

  /** Which AI providers this server has configured (no secrets). */
  app.get("/v1/premium/ai", async (req) => {
    requirePremium(req);
    return { providers: listProviders() };
  });

  app.get("/v1/premium/usage", async (req) => {
    const user = requirePremium(req);
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await prisma.aiUsage.groupBy({ by: ["feature", "provider"], where: { userId: user.id, createdAt: { gte: since } }, _count: true, _sum: { inputTokens: true, outputTokens: true } });
    return { last24h: rows.map((r) => ({ feature: r.feature, provider: r.provider, requests: r._count, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })) };
  });

  /**
   * Entitlement webhook (RevenueCat-style). The store SDK on the phone handles purchase;
   * this flips the server-side tier so premium endpoints unlock.
   */
  app.post("/v1/webhooks/revenuecat", async (req, reply) => {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) throw new HttpProblem(503, "not_configured", "Webhook secret not configured");
    if (req.headers.authorization !== `Bearer ${secret}`) throw new HttpProblem(401, "unauthorized", "Bad webhook secret");
    const body = z
      .object({
        event: z.object({
          type: z.string(),
          app_user_id: z.string(),
          expiration_at_ms: z.number().nullable().optional(),
          original_transaction_id: z.string().nullable().optional(),
        }),
      })
      .parse(req.body);
    const e = body.event;
    const active = !["CANCELLATION", "EXPIRATION", "BILLING_ISSUE"].includes(e.type) || (e.expiration_at_ms ?? 0) > Date.now();
    await prisma.user.updateMany({
      where: { OR: [{ id: e.app_user_id }, { installId: e.app_user_id }] },
      data: {
        tier: active ? "premium" : "free",
        premiumExpiresAt: e.expiration_at_ms ? new Date(e.expiration_at_ms) : null,
        subscriptionRef: e.original_transaction_id ?? undefined,
      },
    });
    return reply.send({ ok: true });
  });
}

function translate(err: unknown): Error {
  if (err instanceof PremiumUnavailableError) return new HttpProblem(503, "ai_unavailable", err.message);
  if (err instanceof QuotaExceededError) return new HttpProblem(429, "quota_exceeded", err.message);
  if (err instanceof AiRefusalError) return new HttpProblem(422, "ai_refused", err.message);
  if (err instanceof AiProviderError) return new HttpProblem(502, "ai_error", err.message);
  if (err instanceof HttpProblem) return err;
  return new HttpProblem(502, "ai_error", err instanceof Error ? err.message : "AI request failed");
}
