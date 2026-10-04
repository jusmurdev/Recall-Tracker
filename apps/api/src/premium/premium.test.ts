import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { sha256 } from "../lib/crypto.js";
import { resetDb } from "../test/db.js";
import { materialize } from "./purchaseImport.js";
import { attachRestaurant, canRefresh, extractSupplierTerms, getOrCreateProfile, isFresh, researchProfile, restaurantKey, type Research } from "./restaurantResearch.js";

/** Exercises the parts of the premium flows that run after Claude responds (no network). */
describe("premium post-processing", () => {
  let userId: string;
  beforeAll(async () => {
    await resetDb();
    await ingestSource("FDA", { now: new Date("2026-10-04T12:00:00Z") });
    await ingestSource("FSIS", { now: new Date("2026-10-04T12:00:00Z") });
    userId = (await prisma.user.create({ data: { installId: "p1", tokenHash: sha256("p1"), tier: "premium" } })).id;
  });
  afterAll(async () => prisma.$disconnect());

  it("turns an import result into watch items with instant alerts and skips duplicates", async () => {
    const connector = await prisma.connector.create({ data: { userId, provider: "instacart", displayName: "Instacart", mcpUrl: "https://mcp.example.com" } });
    const parsed = {
      retailer: "Instacart",
      notes: "Imported 3 items.",
      items: [
        { name: "Jif Creamy Peanut Butter 16 oz", brand: "Jif", upc: null, category: "food" as const, lastPurchasedAt: "2026-09-20", timesPurchased: 3 },
        { name: "Cold-Pressed Green Juice", brand: "Sunny Valley", upc: "851234007011", category: "food" as const, lastPurchasedAt: null, timesPurchased: 1 },
        { name: "Bananas", brand: null, upc: null, category: "food" as const, lastPurchasedAt: null, timesPurchased: 9 },
      ],
    };
    const first = await materialize(parsed, connector, userId);
    expect(first.created).toHaveLength(3);
    expect(first.created.find((w) => w.upc === "851234007011")?.kind).toBe("upc");
    const alerts = await prisma.alert.findMany({ where: { userId }, include: { recall: true } });
    expect(alerts.map((a) => a.recall.sourceId).sort()).toEqual(["F-1456-2026", "F-1460-2026"]);
    const second = await materialize(parsed, connector, userId);
    expect(second.created).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(3);
  });

  const RESEARCH: Research = {
    summary: "Classic deli sourcing cold cuts from a national brand.",
    suppliers: [
      { name: "Boar's Head", kind: "brand", confidence: "confirmed", sourceUrl: "https://example.com/menu" },
      { name: "Sysco", kind: "distributor", confidence: "likely", sourceUrl: null },
      { name: "Chicken", kind: "ingredient", confidence: "confirmed", sourceUrl: null },
      { name: "Mystery Farms", kind: "producer", confidence: "guess", sourceUrl: null },
    ],
    riskSignals: [],
    sources: ["https://example.com/menu"],
  };

  it("normalises restaurant identity into one shared key", () => {
    expect(restaurantKey({ name: "Joe's Crab Shack", city: "Austin", state: "tx" })).toBe(restaurantKey({ name: "joes crab shack restaurant", city: " austin ", state: "TX" }));
    expect(restaurantKey({ name: "Anything", website: "https://www.Deli-Downtown.com/menu" })).toBe("host:deli-downtown.com");
    expect(restaurantKey({ name: "Joe's", city: "Austin", state: "TX" })).not.toBe(restaurantKey({ name: "Joe's", city: "Dallas", state: "TX" }));
  });

  it("filters generic ingredients and guesses out of supplier terms", () => {
    expect(extractSupplierTerms(RESEARCH)).toEqual(["boar's head", "sysco"]);
  });

  it("stores research once on the shared profile and reuses it for later users without calling the AI", async () => {
    const second = (await prisma.user.create({ data: { installId: "p2", tokenHash: sha256("p2"), tier: "premium" } })).id;
    const identity = { name: "Deli Downtown", city: "Richmond", state: "VA" };

    // User 1 adds the restaurant: nothing cached yet, research is needed.
    const item1 = await prisma.watchItem.create({ data: { userId, kind: "restaurant", label: "Deli Downtown", terms: ["deli downtown"], restaurantName: identity.name, restaurantCity: identity.city, restaurantState: identity.state } });
    const first = await attachRestaurant(item1, identity);
    expect(first.cached).toBe(false);
    expect(first.profile.researchStatus).toBe("pending");
    expect(isFresh(first.profile)).toBe(false);

    // The worker researches the profile. A stub client stands in for Claude.
    const calls: number[] = [];
    const stub = {
      messages: {
        create: async () => {
          calls.push(1);
          return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(RESEARCH) }], usage: { input_tokens: 10, output_tokens: 5 } };
        },
      },
    } as unknown as import("@anthropic-ai/sdk").default;
    const outcome = await researchProfile(first.profile.id, userId, stub);
    expect(calls).toHaveLength(1);
    expect(outcome.cached).toBe(false);
    expect(outcome.supplierTerms).toEqual(["boar's head", "sysco"]);
    expect(outcome.matchesByItem[item1.id]?.map((m) => m.recall.sourceId)).toEqual(["031-2026"]);
    expect(outcome.matchesByItem[item1.id]?.[0]?.match.reason).toBe("restaurant_supplier");
    const stored1 = await prisma.watchItem.findUniqueOrThrow({ where: { id: item1.id } });
    expect(stored1.terms).toEqual(["deli downtown", "boar's head", "sysco"]);
    expect(stored1.researchSummary).toContain("deli");
    expect(await prisma.alert.count({ where: { watchItemId: item1.id } })).toBe(1);
    expect(await prisma.aiUsage.count({ where: { userId, feature: "restaurant_research" } })).toBe(1);

    const profile = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: first.profile.id } });
    expect(profile.researchStatus).toBe("ready");
    expect(profile.researchCount).toBe(1);
    expect(isFresh(profile)).toBe(true);
    expect(canRefresh(profile)).toBe(false); // researched just now; min refresh age not reached

    // User 2 adds the same restaurant (different spelling): cache hit, instant results, no AI.
    const item2 = await prisma.watchItem.create({ data: { userId: second, kind: "restaurant", label: "deli downtown", terms: ["deli downtown"], restaurantName: "Deli Downtown Restaurant", restaurantCity: "richmond", restaurantState: "va" } });
    const reuse = await attachRestaurant(item2, { name: "Deli Downtown Restaurant", city: "richmond", state: "va" });
    expect(reuse.cached).toBe(true);
    expect(reuse.profile.id).toBe(first.profile.id);
    expect(reuse.matches.map((m) => m.recall.sourceId)).toEqual(["031-2026"]);
    expect((await prisma.watchItem.findUniqueOrThrow({ where: { id: item2.id } })).terms).toContain("sysco");
    expect((await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: first.profile.id } })).cacheHits).toBe(1);
    expect(await prisma.alert.count({ where: { userId: second } })).toBe(1);
    expect(await prisma.aiUsage.count({ where: { userId: second } })).toBe(0);

    // Re-running research on a fresh profile is a no-op for the AI.
    const again = await researchProfile(first.profile.id, second, stub);
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await prisma.restaurantProfile.count()).toBe(1);
  });

  it("re-researches once the cached result is stale and keeps the old result if the AI fails", async () => {
    const profile = await getOrCreateProfile({ name: "Old Place", city: "Boise", state: "ID" });
    const stale = new Date(Date.now() - 400 * 86_400_000);
    await prisma.restaurantProfile.update({ where: { id: profile.id }, data: { researchStatus: "ready", researchedAt: stale, summary: "old", supplierTerms: ["old supplier"], researchJson: { ...RESEARCH, summary: "old" } } });
    await prisma.watchItem.create({ data: { userId, kind: "restaurant", label: "Old Place", terms: ["old place"], restaurantProfileId: profile.id } });
    const fresh = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(isFresh(fresh)).toBe(false);
    expect(canRefresh(fresh)).toBe(true);

    const failing = { messages: { create: async () => { throw new Error("boom"); } } } as unknown as import("@anthropic-ai/sdk").default;
    await expect(researchProfile(profile.id, userId, failing)).rejects.toThrow("boom");
    const after = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(after.researchStatus).toBe("ready"); // old research still usable
    expect(after.researchError).toBe("boom");
    expect(after.summary).toBe("old");
  });
});
