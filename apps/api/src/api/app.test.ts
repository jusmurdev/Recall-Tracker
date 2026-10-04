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

  it("offers a shared catalog with grades so users pick instead of re-creating restaurants", async () => {
    await prisma.user.update({ where: { id: userId }, data: { tier: "premium" } });
    // Someone else added and graded Capitol Deli earlier.
    const other = await prisma.user.create({ data: { installId: "cat-other", tokenHash: "cat-other", tier: "premium" } });
    const profile = await prisma.restaurantProfile.create({
      data: { key: "name:capitol deli|manhattan|NY", name: "Capitol Deli", city: "Manhattan", state: "NY", latitude: 40.7075, longitude: -74.011, currentGrade: "B", currentScore: 18, gradeScale: "nyc_points", gradeSource: "nyc_dohmh", gradeCheckedAt: new Date(), lastInspectedAt: new Date("2026-08-01"), researchStatus: "ready", researchedAt: new Date(), summary: "Deli", supplierTerms: ["boar's head"], researchJson: { summary: "Deli", suppliers: [], riskSignals: [], sources: [] } },
    });
    await prisma.watchItem.create({ data: { userId: other.id, kind: "restaurant", label: "Capitol Deli", terms: ["capitol deli"], restaurantProfileId: profile.id } });

    const search = await app.inject({ method: "GET", url: "/v1/premium/restaurants/search?q=capitol&lat=40.70&lng=-74.01", headers: auth() });
    expect(search.statusCode).toBe(200);
    expect(search.json().items[0]).toMatchObject({ profileId: profile.id, trackedBy: 1, researchStatus: "ready", activeRecalls: 1, watchItemId: null, grade: { grade: "B", level: "ok" } });
    expect(search.json().items[0].distanceKm).toBeLessThan(1);
    expect((await app.inject({ method: "GET", url: "/v1/premium/restaurants/search?q=capital%20delli", headers: auth() })).json().items[0]?.profileId).toBe(profile.id); // fuzzy
    expect((await app.inject({ method: "GET", url: "/v1/premium/restaurants/search?q=zzzz", headers: auth() })).json().items).toEqual([]);

    // Pick from the catalog: no name needed, instant research + grade, no new profile.
    const profilesBefore = await prisma.restaurantProfile.count();
    const picked = await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "restaurant", terms: [], restaurant: { profileId: profile.id } } });
    expect(picked.statusCode).toBe(201);
    expect(picked.json().item.label).toBe("Capitol Deli");
    expect(picked.json().research.status).toBe("cached");
    expect(await prisma.restaurantProfile.count()).toBe(profilesBefore);
    const itemId = picked.json().item.id;
    const detail = await app.inject({ method: "GET", url: `/v1/premium/restaurants/${itemId}`, headers: auth() });
    expect(detail.json().grade).toMatchObject({ grade: "B", score: 18, level: "ok", label: "B — some violations" });
    expect(detail.json().gradeCoverage).toBe("open_data");
    expect(detail.json().shared.trackedBy).toBe(2);

    // Grade refresh is throttled to daily; the catalog entry survives the user removing it.
    const refresh = await app.inject({ method: "POST", url: `/v1/premium/restaurants/${itemId}/grade/refresh`, headers: auth() });
    expect(refresh.json()).toMatchObject({ queued: false, reason: "too_recent" });
    await prisma.restaurantNotice.create({ data: { userId, profileId: profile.id, kind: "grade_change", title: "Capitol Deli: health grade dropped to C", body: "C (was B).", data: { direction: "worse" } } });
    const updates = await app.inject({ method: "GET", url: "/v1/premium/restaurants/updates", headers: auth() });
    expect(updates.json().unread).toBe(1);
    expect(updates.json().items[0]).toMatchObject({ restaurant: "Capitol Deli", watchItemId: itemId, kind: "grade_change" });
    await app.inject({ method: "POST", url: "/v1/premium/restaurants/updates/read-all", headers: auth() });
    expect((await app.inject({ method: "GET", url: "/v1/premium/restaurants/updates", headers: auth() })).json().unread).toBe(0);
    expect((await app.inject({ method: "DELETE", url: `/v1/watchlist/${itemId}`, headers: auth() })).statusCode).toBe(204);
    expect(await prisma.restaurantProfile.findUnique({ where: { id: profile.id } })).not.toBeNull();
    expect((await app.inject({ method: "GET", url: "/v1/premium/restaurants/search?q=capitol", headers: auth() })).json().items[0].trackedBy).toBe(1);
  });

  it("exposes package codes and remedy on recalls", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/recalls?q=jif" });
    const jif = res.json().items[0];
    expect(jif.codeInfo).toContain("Lot codes");
    expect(jif.remedy).toBeTruthy();
  });

  it("updates notification preferences and lets users dismiss/resolve alerts", async () => {
    const prefs = await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { pushMinSeverity: "high", mutedCategories: ["consumer_product"], quietHoursStart: 22, quietHoursEnd: 7, timezone: "America/Denver", digestMode: true, digestHour: 8 } });
    expect(prefs.statusCode).toBe(200);
    expect(prefs.json()).toMatchObject({ pushMinSeverity: "high", mutedCategories: ["consumer_product"], quietHoursStart: 22, quietHoursEnd: 7, digestMode: true, digestHour: 8 });
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { quietHoursStart: null, quietHoursEnd: null } })).json().quietHoursStart).toBeNull();
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { quietHoursStart: 5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { digestHour: 30 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth() })).json().preferences.pushMinSeverity).toBe("high");

    const sub = await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "category", label: "Critical food near me", terms: [], categories: ["food"], minSeverity: "critical" } });
    expect(sub.statusCode).toBe(201);
    expect(sub.json().item.minSeverity).toBe("critical");
    expect(sub.json().matches.map((m: { reason: string }) => m.reason)).toEqual(["category_subscription"]);
    expect((await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "category", label: "x", terms: [], categories: [] } })).statusCode).toBe(400);

    const alerts = await app.inject({ method: "GET", url: "/v1/alerts", headers: auth() });
    const target = alerts.json().items[0];
    expect((await app.inject({ method: "POST", url: `/v1/alerts/${target.id}/dismiss`, headers: auth(), payload: { reason: "dont_have" } })).json()).toEqual({ dismissed: true });
    let list = await app.inject({ method: "GET", url: "/v1/alerts", headers: auth() });
    expect(list.json().items.find((a: { id: string }) => a.id === target.id)).toBeUndefined();
    list = await app.inject({ method: "GET", url: "/v1/alerts?includeDismissed=true", headers: auth() });
    expect(list.json().items.find((a: { id: string }) => a.id === target.id).dismissReason).toBe("dont_have");
    await app.inject({ method: "POST", url: `/v1/alerts/${target.id}/undismiss`, headers: auth() });
    expect((await app.inject({ method: "POST", url: `/v1/alerts/${target.id}/resolve`, headers: auth(), payload: { action: "returned" } })).json()).toEqual({ resolved: true });
    const detail = await app.inject({ method: "GET", url: `/v1/alerts/${target.id}`, headers: auth() });
    expect(detail.json()).toMatchObject({ dismissedAt: null, resolvedAction: "returned" });
    expect((await app.inject({ method: "POST", url: `/v1/alerts/${target.id}/resolve`, headers: auth(), payload: { action: "ate_it" } })).statusCode).toBe(400);
    const summary = await app.inject({ method: "GET", url: "/v1/alerts/summary", headers: auth() });
    expect(summary.json().resolved).toBe(1);
  });

  it("deletes the account and everything attached to it", async () => {
    const other = await app.inject({ method: "POST", url: "/v1/auth/anonymous", payload: { installId: "delete-me-install", platform: "ios" } });
    const h = { authorization: `Bearer ${other.json().token}` };
    await app.inject({ method: "POST", url: "/v1/watchlist", headers: h, payload: { kind: "product", label: "Jif", terms: ["jif"] } });
    await app.inject({ method: "POST", url: "/v1/devices", headers: h, payload: { expoPushToken: "ExponentPushToken[del]", platform: "ios" } });
    const id = other.json().user.id;
    expect((await app.inject({ method: "DELETE", url: "/v1/me", headers: h })).statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.watchItem.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.alert.count({ where: { userId: id } })).toBe(0);
    expect(await prisma.device.count({ where: { userId: id } })).toBe(0);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: h })).statusCode).toBe(401);
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
