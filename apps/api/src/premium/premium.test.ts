import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { sha256 } from "../lib/crypto.js";
import { resetDb } from "../test/db.js";
import { materialize } from "./purchaseImport.js";
import { applyResearch } from "./restaurantResearch.js";

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

  it("merges supplier terms from research and matches recalls", async () => {
    const item = await prisma.watchItem.create({
      data: { userId, kind: "restaurant", label: "Deli Downtown", terms: ["deli downtown"], restaurantName: "Deli Downtown", restaurantState: "VA" },
    });
    const outcome = await applyResearch(item, {
      summary: "Classic deli sourcing cold cuts from a national brand.",
      suppliers: [
        { name: "Boar's Head", kind: "brand", confidence: "confirmed", sourceUrl: "https://example.com/menu" },
        { name: "Sysco", kind: "distributor", confidence: "likely", sourceUrl: null },
        { name: "Chicken", kind: "ingredient", confidence: "confirmed", sourceUrl: null },
        { name: "Mystery Farms", kind: "producer", confidence: "guess", sourceUrl: null },
      ],
      riskSignals: [],
      sources: ["https://example.com/menu"],
    });
    expect(outcome.supplierTerms).toEqual(["boar's head", "sysco"]);
    expect(outcome.matches.map((m) => m.recall.sourceId)).toEqual(["031-2026"]);
    expect(outcome.matches[0]!.match.reason).toBe("restaurant_supplier");
    const stored = await prisma.watchItem.findUnique({ where: { id: item.id } });
    expect(stored?.terms).toEqual(["deli downtown", "boar's head", "sysco"]);
    expect(stored?.researchSummary).toContain("deli");
    expect(await prisma.alert.count({ where: { watchItemId: item.id } })).toBe(1);
  });
});
