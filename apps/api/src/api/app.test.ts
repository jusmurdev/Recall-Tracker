import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { resetDb } from "../test/db.js";
import { buildApp } from "./app.js";

const NOW = new Date("2026-10-04T12:00:00Z");

describe("HTTP API (integration)", () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    await resetDb();
    await ingestSource("FDA", { now: NOW });
    await ingestSource("FSIS", { now: NOW });
    await ingestSource("CPSC", { now: NOW });
    app = await buildApp({ logger: false });
    const res = await app.inject({ method: "POST", url: "/v1/auth/anonymous", payload: { installId: "install-abcdef", platform: "ios" } });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    userId = res.json().user.id;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("serves the public feed with filters, search and pagination", async () => {
    const all = await app.inject({ method: "GET", url: "/v1/recalls?limit=4" });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(4);
    expect(all.json().nextCursor).toBeTypeOf("string");
    const page2 = await app.inject({ method: "GET", url: `/v1/recalls?limit=4&cursor=${all.json().nextCursor}` });
    expect(page2.json().items).toHaveLength(4);
    expect(new Set([...all.json().items, ...page2.json().items].map((r: { id: string }) => r.id)).size).toBe(8);

    const food = await app.inject({ method: "GET", url: "/v1/recalls?category=food&severity=critical" });
    expect(food.json().items.map((r: { sourceId: string }) => r.sourceId)).toEqual(["F-1456-2026"]);

    const search = await app.inject({ method: "GET", url: "/v1/recalls?q=listeria" });
    expect(search.json().items.map((r: { sourceId: string }) => r.sourceId).sort()).toEqual(["031-2026", "F-1471-2026"]);

    const tx = await app.inject({ method: "GET", url: "/v1/recalls?state=tx" });
    expect(tx.json().items.map((r: { sourceId: string }) => r.sourceId)).toContain("F-1399-2026");
    expect(tx.json().items.map((r: { sourceId: string }) => r.sourceId)).not.toContain("F-1460-2026");

    const bad = await app.inject({ method: "GET", url: "/v1/recalls?severity=huge" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("validation");

    const stats = await app.inject({ method: "GET", url: "/v1/recalls/stats" });
    expect(stats.json().totalBySource).toEqual({ FDA: 5, FSIS: 2, CPSC: 2 });
  });

  it("requires auth for personal endpoints", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/watchlist" });
    expect(res.statusCode).toBe(401);
  });

  it("creates watch items with instant matches and lists alerts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/watchlist",
      headers: auth(),
      payload: { kind: "product", label: "Jif", terms: ["jif", "peanut butter"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().matches).toHaveLength(1);
    expect(res.json().matches[0].reason).toBe("brand_match");

    const alerts = await app.inject({ method: "GET", url: "/v1/alerts", headers: auth() });
    expect(alerts.json().items).toHaveLength(1);
    expect(alerts.json().unread).toBe(1);
    const id = alerts.json().items[0].id;
    await app.inject({ method: "POST", url: `/v1/alerts/${id}/read`, headers: auth() });
    expect((await app.inject({ method: "GET", url: "/v1/alerts?unreadOnly=true", headers: auth() })).json().items).toHaveLength(0);

    const list = await app.inject({ method: "GET", url: "/v1/watchlist", headers: auth() });
    expect(list.json().items).toHaveLength(1);
    const del = await app.inject({ method: "DELETE", url: `/v1/watchlist/${list.json().items[0].id}`, headers: auth() });
    expect(del.statusCode).toBe(204);
  });

  it("matches OCR scans and barcodes, optionally saving a watch item", async () => {
    const ocr = await app.inject({
      method: "POST",
      url: "/v1/scan/match",
      headers: auth(),
      payload: { ocrText: "Boar's Head\nSTRASSBURGER\nLIVERWURST\nMade in Virginia\nNET WT 3.5 LB", context: "deli counter", watch: true },
    });
    expect(ocr.statusCode).toBe(200);
    expect(ocr.json().extracted.brand).toBe("Boar's Head");
    expect(ocr.json().matches[0].recall.sourceId).toBe("031-2026");
    expect(ocr.json().watchItem.kind).toBe("scan");

    const upc = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { upc: "051500241281" } });
    expect(upc.json().matches[0].reason).toBe("upc_exact");
    expect(upc.json().watchItem).toBeNull();

    const empty = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it("gates premium features behind the tier", async () => {
    const restaurant = await app.inject({
      method: "POST",
      url: "/v1/watchlist",
      headers: auth(),
      payload: { kind: "restaurant", label: "Joe's", terms: [], restaurant: { name: "Joe's Crab Shack", city: "Austin", state: "TX" } },
    });
    expect(restaurant.statusCode).toBe(402);
    expect(restaurant.json().code).toBe("premium_required");
    expect((await app.inject({ method: "GET", url: "/v1/premium/connectors", headers: auth() })).statusCode).toBe(402);

    await prisma.user.update({ where: { id: userId }, data: { tier: "premium" } });
    const connectors = await app.inject({
      method: "POST",
      url: "/v1/premium/connectors",
      headers: auth(),
      payload: { provider: "instacart", displayName: "My Instacart", mcpUrl: "https://mcp.example.com/instacart", authorizationToken: "secret-token" },
    });
    expect(connectors.statusCode).toBe(201);
    expect(connectors.json().hasToken).toBe(true);
    const stored = await prisma.connector.findFirst({ where: { userId } });
    expect(stored?.tokenCiphertext).not.toContain("secret-token");

    // Without an ANTHROPIC_API_KEY the import reports the AI as unavailable rather than crashing.
    const imp = await app.inject({ method: "POST", url: `/v1/premium/connectors/${connectors.json().id}/import`, headers: auth() });
    expect(imp.statusCode).toBe(503);
    expect(imp.json().code).toBe("ai_unavailable");

    const me = await app.inject({ method: "GET", url: "/v1/me", headers: auth() });
    expect(me.json().premium.features.restaurants).toBe(true);
  });

  it("shares restaurant research across users through a cached profile", async () => {
    // Pre-seed a researched profile as if another user's research had completed.
    const seeded = await prisma.restaurantProfile.create({
      data: {
        key: "name:joes crab shack|austin|TX",
        name: "Joe's Crab Shack",
        city: "Austin",
        state: "TX",
        researchStatus: "ready",
        researchedAt: new Date(),
        summary: "Seafood chain supplied by a national distributor.",
        supplierTerms: ["sysco", "boar's head"],
        researchJson: { summary: "Seafood chain supplied by a national distributor.", suppliers: [{ name: "Sysco", kind: "distributor", confidence: "confirmed", sourceUrl: null }], riskSignals: [{ signal: "2025 inspection: cold holding violation", sourceUrl: null }], sources: ["https://example.com"] },
        researchCount: 1,
      },
    });

    const lookup = await app.inject({ method: "GET", url: "/v1/premium/restaurants/lookup?name=Joe's%20Crab%20Shack&city=Austin&state=TX", headers: auth() });
    expect(lookup.json()).toMatchObject({ known: true, profileId: seeded.id, fresh: true, trackedBy: 0 });
    expect((await app.inject({ method: "GET", url: "/v1/premium/restaurants/lookup?name=Nowhere&state=TX", headers: auth() })).json()).toEqual({ known: false });

    const created = await app.inject({
      method: "POST",
      url: "/v1/watchlist",
      headers: auth(),
      payload: { kind: "restaurant", label: "Joe's", terms: [], restaurant: { name: "Joe's Crab Shack", city: "Austin", state: "TX" } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().research).toMatchObject({ status: "cached", profileId: seeded.id });
    expect(created.json().researchQueued).toBe(false);
    expect(created.json().item.terms).toContain("sysco");
    expect(created.json().matches.map((m: { recall: { sourceId: string } }) => m.recall.sourceId)).toEqual(["031-2026"]);
    const itemId = created.json().item.id;

    const detail = await app.inject({ method: "GET", url: `/v1/premium/restaurants/${itemId}`, headers: auth() });
    expect(detail.json()).toMatchObject({ status: "ready", supplierTerms: ["sysco", "boar's head"], shared: { profileId: seeded.id, trackedBy: 1, researchCount: 1, cacheHits: 1, fresh: true, canRefresh: false } });
    expect(detail.json().riskSignals).toHaveLength(1);

    // Refresh is throttled while the shared research is recent.
    const refresh = await app.inject({ method: "POST", url: `/v1/premium/restaurants/${itemId}/refresh`, headers: auth() });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json()).toMatchObject({ queued: false, reason: "too_recent" });

    // A restaurant nobody has researched yet gets a pending profile and (with queues disabled in tests) reports unavailable.
    const novel = await app.inject({
      method: "POST",
      url: "/v1/watchlist",
      headers: auth(),
      payload: { kind: "restaurant", label: "New Spot", terms: [], restaurant: { name: "New Spot", city: "Denver", state: "CO" } },
    });
    expect(novel.json().research.status).toBe("unavailable");
    expect(await prisma.restaurantProfile.count()).toBe(2);
  });

  it("accepts a coarse location, uses it for ranking, and finds tracked restaurants nearby", async () => {
    // First report with no home state set becomes home; later reports only move lastKnownState.
    await prisma.user.update({ where: { id: userId }, data: { homeState: null, lastKnownState: null, tier: "premium" } });
    const first = await app.inject({ method: "PUT", url: "/v1/me/location", headers: auth(), payload: { state: "ca" } });
    expect(first.json()).toMatchObject({ homeState: "CA", lastKnownState: "CA" });
    const travel = await app.inject({ method: "PUT", url: "/v1/me/location", headers: auth(), payload: { state: "NV" } });
    expect(travel.json()).toMatchObject({ homeState: "CA", lastKnownState: "NV" });
    expect((await app.inject({ method: "PUT", url: "/v1/me/location", headers: auth(), payload: { state: "California" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth() })).json()).toMatchObject({ homeState: "CA", lastKnownState: "NV" });

    // The juice recall was distributed in AZ/CA/NV/OR: a user at home in CA but currently in NV is not down-ranked.
    const juice = await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "product", label: "Green juice", terms: ["green juice"] } });
    expect(juice.json().matches[0].explanation).not.toContain("Not reported as distributed");
    await prisma.user.update({ where: { id: userId }, data: { homeState: "NY", lastKnownState: "FL" } });
    const away = await app.inject({ method: "GET", url: `/v1/watchlist/${juice.json().item.id}/matches`, headers: auth() });
    expect(away.json().matches[0].explanation).toContain("Not reported as distributed in NY or FL");

    // Restaurant with coordinates → profile stores them → nearby finds it, with supplier recall count.
    const created = await app.inject({
      method: "POST",
      url: "/v1/watchlist",
      headers: auth(),
      payload: { kind: "restaurant", label: "Deli", terms: [], restaurant: { name: "Capitol Deli", city: "Richmond", state: "VA", latitude: 37.5407, longitude: -77.436 } },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().item.restaurant).toMatchObject({ latitude: 37.5407, longitude: -77.436 });
    await prisma.restaurantProfile.update({
      where: { id: created.json().research.profileId },
      data: { researchStatus: "ready", researchedAt: new Date(), summary: "Deli", supplierTerms: ["boar's head"], researchJson: { summary: "Deli", suppliers: [], riskSignals: [], sources: [] } },
    });
    const near = await app.inject({ method: "GET", url: "/v1/premium/restaurants/nearby?lat=37.55&lng=-77.44&radiusKm=3", headers: auth() });
    expect(near.statusCode).toBe(200);
    expect(near.json().items).toHaveLength(1);
    expect(near.json().items[0]).toMatchObject({ name: "Capitol Deli", trackedBy: 1, activeRecalls: 1, watchItemId: created.json().item.id });
    expect(near.json().items[0].distanceKm).toBeLessThan(2);
    const far = await app.inject({ method: "GET", url: "/v1/premium/restaurants/nearby?lat=38.9&lng=-77.03&radiusKm=5", headers: auth() });
    expect(far.json().items).toHaveLength(0);
    const list = await app.inject({ method: "GET", url: "/v1/watchlist", headers: auth() });
    expect(list.json().items.find((w: { id: string }) => w.id === created.json().item.id).restaurant.latitude).toBe(37.5407);
  });

  it("flips tiers from the entitlement webhook", async () => {
    process.env.REVENUECAT_WEBHOOK_SECRET = "whsec";
    const res = await app.inject({
      method: "POST",
      url: "/v1/webhooks/revenuecat",
      headers: { authorization: "Bearer whsec" },
      payload: { event: { type: "EXPIRATION", app_user_id: userId, expiration_at_ms: Date.now() - 1000 } },
    });
    expect(res.statusCode).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: userId } }))?.tier).toBe("free");
    expect((await app.inject({ method: "POST", url: "/v1/webhooks/revenuecat", headers: { authorization: "Bearer nope" }, payload: {} })).statusCode).toBe(401);
  });
});
