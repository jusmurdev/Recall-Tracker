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

  it("allows the methods the app uses through CORS preflight", async () => {
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const res = await app.inject({ method: "OPTIONS", url: "/v1/me/preferences", headers: { origin: "http://localhost:8080", "access-control-request-method": method } });
      expect(res.statusCode, method).toBe(204);
      expect(String(res.headers["access-control-allow-methods"]), method).toContain(method);
    }
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

  it("checks a receipt line by line and can watch everything on it", async () => {
    await prisma.user.update({ where: { id: userId }, data: { tier: "free", homeState: "VA" } });
    const receipt = "KROGER\n10/02/2026\nJIF CRMY PNT BTR 16Z 3.49 F\nBOARS HEAD LVRWRST 6.99 F\nBNNA ORG 2.58 F\nKRGR WHL MLK GAL 3.19 F\nSUBTOTAL 16.25\nVISA 16.25";
    const res = await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: { ocrText: receipt } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.store).toBe("Kroger");
    expect(body.purchasedAt).toBe("2026-10-02");
    expect(body.items).toHaveLength(4);
    const byProduct = Object.fromEntries(body.items.map((i: { product: string; status: string; matches: Array<{ recall: { sourceId: string } }> }) => [i.product, i]));
    expect(byProduct["jif creamy peanut butter 16 oz"].status).toBe("recalled");
    expect(byProduct["jif creamy peanut butter 16 oz"].matches[0].recall.sourceId).toBe("F-1456-2026");
    expect(byProduct["boars head liverwurst"].status).toBe("recalled");
    expect(byProduct["banana organic"].status).toBe("clear");
    expect(byProduct["kroger whole milk gal"].status).toBe("clear");
    expect(body.flagged).toBe(2);
    expect(body.watched).toBe(false);
    expect(body.decodedByAi).toBe(false);

    // Photo decoding is premium-only.
    expect((await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: { ocrText: receipt, imageBase64: "x".repeat(200) } })).statusCode).toBe(402);

    // Watch everything: creates watch items once, alerts for the recalled ones.
    const before = await prisma.watchItem.count({ where: { userId } });
    const watched = await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: { ocrText: receipt, watch: true, context: "weekly shop" } });
    // Lines with a brand or product name are watched; "banana organic" (generic words only) is not,
    // because it could never match a recall without raising noise.
    const watchedItems = watched.json().items as Array<{ product: string; watchItemId: string | null }>;
    expect(watchedItems.filter((i) => i.watchItemId)).toHaveLength(3);
    expect(watchedItems.find((i) => i.product === "banana organic")!.watchItemId).toBeNull();
    expect(await prisma.watchItem.count({ where: { userId } })).toBe(before + 3);
    const again = await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: { ocrText: receipt, watch: true } });
    expect(await prisma.watchItem.count({ where: { userId } })).toBe(before + 3); // de-duplicated
    expect(again.json().items[0].watchItemId).toBe(watched.json().items[0].watchItemId);
    const jifItem = await prisma.watchItem.findUniqueOrThrow({ where: { id: watched.json().items[0].watchItemId } });
    expect(jifItem).toMatchObject({ kind: "scan", importedFrom: "receipt" });
    expect(jifItem.context).toContain("Kroger receipt on 2026-10-02");
    expect(await prisma.alert.count({ where: { userId, recall: { sourceId: "F-1456-2026" } } })).toBeGreaterThanOrEqual(1);

    // History and re-check.
    const list = await app.inject({ method: "GET", url: "/v1/scan/receipts", headers: auth() });
    expect(list.json().items).toHaveLength(3);
    expect(list.json().items[0]).toMatchObject({ store: "Kroger", itemCount: 4, flaggedCount: 2, watched: true });
    const detail = await app.inject({ method: "GET", url: `/v1/scan/receipts/${watched.json().id}`, headers: auth() });
    expect(detail.json().items).toHaveLength(4);
    expect(detail.json().flagged).toBe(2);
    expect((await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: {} })).statusCode).toBe(400);
  });

  it("gives a typed product name and a receipt line the same verdict (device bugs 2, 5, 6)", async () => {
    // Short typed names used to collapse into one whole-phrase term that is not a substring of the title.
    const typed = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { ocrText: "Prairie Paws dog food" } });
    expect(typed.statusCode).toBe(200);
    expect(typed.json().status).toBe("recalled");
    expect(typed.json().matches[0].recall.sourceId).toBe("F-1471-2026");
    expect(typed.json().matches[0].score).toBeGreaterThanOrEqual(0.65);

    // The same words on a receipt land on the same recall with the same verdict.
    const receipt = await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: auth(), payload: { ocrText: "PETSMART\nPRAIRIE PAWS DOG FOOD 24.99\nMILK 3.19\nTOTAL 28.18" } });
    const items = receipt.json().items as Array<{ product: string; status: string; matches: Array<{ recall: { sourceId: string } }> }>;
    const paws = items.find((i) => i.product.startsWith("prairie paws"))!;
    expect(paws.status).toBe("recalled");
    expect(paws.matches[0].recall.sourceId).toBe("F-1471-2026");
    // A single generic word can never flag a product: every dairy recall mentions milk.
    expect(items.find((i) => i.product === "milk")!.status).toBe("clear");
    expect((await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { ocrText: "MILK" } })).json().status).toBe("clear");

    // A different dog food is not dragged in by the generic words.
    const other = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { ocrText: "Acme Kibble dog food" } });
    expect(other.json().matches.map((m: { recall: { sourceId: string } }) => m.recall.sourceId)).not.toContain("F-1471-2026");

    // One common word in common with a recall ("crunch", "prairie") is coincidence, not a match.
    const decoy = (sourceId: string, title: string, productDescription: string) => ({
      source: "FDA" as const, sourceId, title, summary: "Listeria.", productDescription, reason: "Potential Listeria contamination.", category: "food" as const, severity: "high" as const, status: "ongoing" as const,
      company: "Decoy Foods", brands: [] as string[], upcs: [] as string[], distributionStates: ["US"], publishedAt: new Date(), contentHash: `decoy-${sourceId}`, raw: {},
    });
    await prisma.recall.createMany({ data: [decoy("DECOY-CRUNCH", "Decoy Foods: Protein Cereal Cocoa Crunch", "Protein Cereal Cocoa Crunch, 12 oz box"), decoy("DECOY-PRAIRIE", "Decoy Foods: Hondashi Prairie Soup Base", "Hondashi Prairie Soup Base 4 oz")] });
    const zappo = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { ocrText: "Zappo Crunch Bar" } });
    expect(zappo.json().status).toBe("clear");
    expect(zappo.json().matches).toEqual([]);
    const pawsAgain = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { ocrText: "Prairie Paws dog food" } });
    expect(pawsAgain.json().matches.map((m: { recall: { sourceId: string } }) => m.recall.sourceId)).toEqual(["F-1471-2026"]);
    await prisma.recall.deleteMany({ where: { sourceId: { startsWith: "DECOY-" } } });
  });

  it("treats UPC-A, EAN-13 and spaced barcodes as the same code (device bug 7)", async () => {
    for (const upc of ["087654321098", "0087654321098", "0 87654 32109 8", "00087654321098"]) {
      const res = await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { upc } });
      expect(res.statusCode, upc).toBe(200);
      expect(res.json().matches[0]?.reason, upc).toBe("upc_exact");
      expect(res.json().matches[0]?.recall.sourceId, upc).toBe("F-1471-2026");
    }
    expect((await app.inject({ method: "POST", url: "/v1/scan/match", headers: auth(), payload: { upc: "12 34" } })).statusCode).toBe(400);
  });

  it("escapes LIKE wildcards in search and validates state codes (device bugs 11, 13)", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/recalls?q=%25" })).json().items).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/v1/recalls?q=_" })).json().items).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/v1/recalls?state=ZZ" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/v1/recalls?state=ca" })).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/v1/me/location", headers: auth(), payload: { state: "XX" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { homeState: "QQ" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: auth(), payload: { homeState: "tx" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: auth() })).json().homeState).toBe("TX");
  });

  it("de-duplicates watch items, derives terms from the label and strips HTML (device bugs 10, 14, 16)", async () => {
    const first = await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "product", label: "<b>Skippy</b> peanut butter" } });
    expect(first.statusCode).toBe(201);
    expect(first.json().item.label).toBe("Skippy peanut butter");
    expect(first.json().item.terms).toContain("skippy");
    const again = await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "product", label: "skippy PEANUT butter" } });
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect(again.json().item.id).toBe(first.json().item.id);
    expect((await app.inject({ method: "POST", url: "/v1/watchlist", headers: auth(), payload: { kind: "product", label: "" } })).statusCode).toBe(400);
  });

  it("returns a consistent error shape for framework-level errors (device bug 15)", async () => {
    const badJson = await app.inject({ method: "POST", url: "/v1/watchlist", headers: { ...auth(), "content-type": "application/json" }, payload: "{not json" });
    expect(badJson.statusCode).toBe(400);
    expect(badJson.json()).toMatchObject({ error: "bad_json", code: "bad_json" });
    const wrongType = await app.inject({ method: "POST", url: "/v1/watchlist", headers: { ...auth(), "content-type": "application/xml" }, payload: "<hello/>" });
    expect(wrongType.statusCode).toBe(415);
    expect(wrongType.json()).toMatchObject({ error: "unsupported_media_type", code: "unsupported_media_type" });
    const missing = await app.inject({ method: "GET", url: "/v1/nope" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("not_found");
  });

  it("serves a cleaned headline with every recall (device bug 9)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/recalls?q=jif" });
    const jif = res.json().items.find((r: { sourceId: string }) => r.sourceId === "F-1456-2026");
    expect(jif.headline).toBe("Jif Creamy Peanut Butter");
    expect(jif.headline.length).toBeLessThanOrEqual(70);
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

  it("stores a dietary profile, validates it, and alerts on matching recalls (diet_match)", async () => {
    // Fresh user so earlier tests' alerts don't interfere.
    const signin = await app.inject({ method: "POST", url: "/v1/auth/anonymous", payload: { installId: "install-diet-user", platform: "android", timezone: "America/Chicago" } });
    const dietAuth = { authorization: `Bearer ${signin.json().token}` };
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: dietAuth })).json().preferences.timezone).toBe("America/Chicago");

    // Validation: unknown profile, junk allergen text.
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["paleo"] } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { otherAllergens: ["<script>"] } })).statusCode).toBe(400);

    // Turning on a milk allergy backfills the undeclared-milk recall already in the database.
    const saved = await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["allergy_milk", "kosher"], otherAllergens: ["Mustard"] } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().diet).toEqual({ dietProfiles: ["allergy_milk", "kosher"], otherAllergens: ["mustard"] });
    expect(saved.json().dietAlertsAdded).toBeGreaterThanOrEqual(1);
    expect(saved.json().dietAlertsMatching).toBeGreaterThanOrEqual(saved.json().dietAlertsAdded);
    // Off and on again: nothing new is created, but the matches are still reported.
    await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["kosher"] } });
    const again = await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["allergy_milk", "kosher"] } });
    expect(again.json().dietAlertsAdded).toBe(0);
    expect(again.json().dietAlertsMatching).toBeGreaterThanOrEqual(1);
    // Milk off: its alerts stay in the inbox but no longer count as matching the profile.
    const milkOff = await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["kosher"], otherAllergens: [] } });
    const milkAlerts = await prisma.alert.count({ where: { userId: signin.json().user.id, dietProfile: "allergy_milk" } });
    expect(milkAlerts).toBeGreaterThanOrEqual(1);
    expect(milkOff.json().dietAlertsMatching).toBe(await prisma.alert.count({ where: { userId: signin.json().user.id, dietProfile: "kosher", dismissedAt: null, resolvedAt: null } }));
    await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: ["allergy_milk", "kosher"], otherAllergens: ["mustard"] } });
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: dietAuth });
    expect(me.json().diet.dietProfiles).toEqual(["allergy_milk", "kosher"]);

    const alerts = await app.inject({ method: "GET", url: "/v1/alerts", headers: dietAuth });
    const milk = alerts.json().items.find((a: { reason: string; dietProfile: string }) => a.reason === "diet_match" && a.dietProfile === "allergy_milk");
    expect(milk).toBeTruthy();
    expect(milk.recall.sourceId).toBe("F-1460-2026");
    expect(milk.dietKind).toBe("undeclared");
    expect(milk.matchedPhrase.toLowerCase()).toMatch(/milk|whey/);
    expect(milk.explanation).toMatch(/^Undeclared (milk|whey)/);
    expect(milk.explanation).toContain("You listed milk allergy");
    expect(milk.watchItemId).toBeNull(); // no watchlist needed
    expect(milk.score).toBeGreaterThanOrEqual(0.9);

    // The Listeria recalls do not produce diet alerts for this user.
    expect(alerts.json().items.filter((a: { reason: string }) => a.reason === "diet_match").every((a: { recall: { reason: string } }) => !/listeria/i.test(a.recall.reason))).toBe(true);

    // Browse: "For my diet" narrows the feed and explains each hit; without a profile it says so.
    const diet = await app.inject({ method: "GET", url: "/v1/recalls?diet=1", headers: dietAuth });
    expect(diet.json().items.map((r: { sourceId: string }) => r.sourceId)).toContain("F-1460-2026");
    expect(diet.json().items.every((r: { dietHit?: { explanation: string } }) => !!r.dietHit?.explanation)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/v1/recalls?diet=1" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/recalls?diet=1", headers: auth() })).json().diet).toEqual({ configured: false });

    // Scan: a label mentioning casein gets a heads-up even though nothing is recalled.
    const scan = await app.inject({ method: "POST", url: "/v1/scan/match", headers: dietAuth, payload: { ocrText: "ZAPPO CRUNCH BAR\nINGREDIENTS: SUGAR, RICE, CASEIN, PORK GELATIN, MUSTARD FLOUR" } });
    expect(scan.json().status).toBe("clear");
    const byProfile = Object.fromEntries(scan.json().diet.map((h: { profile: string; kind: string; phrase: string }) => [h.profile, h]));
    expect(byProfile.allergy_milk).toMatchObject({ kind: "mention", phrase: "CASEIN" });
    expect(byProfile.kosher.phrase.toLowerCase()).toContain("pork");
    expect(byProfile.allergy_other).toMatchObject({ label: "Mustard allergy" });
    // Receipts carry the same flags per line.
    const receipt = await app.inject({ method: "POST", url: "/v1/scan/receipt", headers: dietAuth, payload: { ocrText: "TARGET\nGG WHOLE MILK 1GAL 3.49\nBNNA ORG 1.29\nTOTAL 4.78" } });
    const milkLine = receipt.json().items.find((i: { product: string }) => i.product.includes("milk"));
    expect(milkLine.dietFlags.map((f: { profile: string }) => f.profile)).toContain("allergy_milk");
    expect(receipt.json().items.find((i: { product: string }) => i.product.includes("banana")).dietFlags).toEqual([]);

    // A new recall ingested later alerts by diet alone. Simulate with a direct insert + match.
    const { matchRecalls } = await import("../matching/engine.js");
    const fresh = await prisma.recall.create({
      data: {
        source: "FDA", sourceId: "DIET-TEST-1", title: "Acme Snacks: Honey Mustard Pretzels", summary: "Undeclared mustard.", productDescription: "Honey Mustard Pretzels 8 oz", reason: "Undeclared mustard.",
        category: "food", severity: "low", status: "ongoing", company: "Acme Snacks", brands: [], upcs: [], distributionStates: ["US"], publishedAt: new Date(), contentHash: "diet-test-1", raw: {},
      },
    });
    const created = await matchRecalls([fresh], { notify: false });
    expect(created).toBeGreaterThanOrEqual(1);
    const mustard = await prisma.alert.findFirst({ where: { recallId: fresh.id, userId: signin.json().user.id } });
    expect(mustard).toMatchObject({ reason: "diet_match", dietProfile: "allergy_other", dietKind: "undeclared" });
    expect(mustard!.explanation).toContain("You listed mustard allergy");

    // Clearing the profile keeps the alerts (they are history) but stops new ones.
    expect((await app.inject({ method: "PATCH", url: "/v1/me/preferences", headers: dietAuth, payload: { dietProfiles: [], otherAllergens: [] } })).json().diet).toEqual({ dietProfiles: [], otherAllergens: [] });
    // Account deletion removes the profile with everything else.
    expect((await app.inject({ method: "DELETE", url: "/v1/me", headers: dietAuth })).statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { installId: "install-diet-user" } })).toBeNull();
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
