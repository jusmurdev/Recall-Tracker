import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { sha256 } from "../lib/crypto.js";
import { resetDb } from "../test/db.js";
import { findRecallsForItem, matchRecalls, scoreMatch } from "./engine.js";

const NOW = new Date("2026-10-04T12:00:00Z");

describe("matching engine (integration)", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ingests fixtures and is idempotent on re-run", async () => {
    const first = await Promise.all([ingestSource("FDA", { now: NOW }), ingestSource("FSIS", { now: NOW }), ingestSource("CPSC", { now: NOW })]);
    expect(first.map((r) => r.inserted)).toEqual([5, 2, 2]);
    const again = await ingestSource("FDA", { now: NOW });
    expect(again.inserted).toBe(0);
    expect(again.unchanged).toBe(5);
    const state = await prisma.sourceSyncState.findUnique({ where: { source: "FDA" } });
    expect(state?.watermark?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(state?.consecutiveFailures).toBe(0);
    expect(await prisma.ingestRun.count({ where: { ok: true } })).toBe(4);
  });

  it("finds recent recalls for a new watch item by brand, fuzzy brand, and UPC", async () => {
    const base = { id: "probe", userId: "u", kind: "product" as const, label: "x", upc: null, categories: [], homeState: null };
    const jif = await findRecallsForItem({ ...base, terms: ["jif", "peanut butter"] });
    expect(jif).toHaveLength(1);
    expect(jif[0]!.match.reason).toBe("brand_match");
    expect(jif[0]!.match.score).toBeGreaterThanOrEqual(0.9);

    // Apostrophe-less and differently spaced brand still matches via trigram similarity.
    const boars = await findRecallsForItem({ ...base, terms: ["boars head"] });
    expect(boars.map((m) => m.recall.sourceId)).toEqual(["031-2026"]);

    const upc = await findRecallsForItem({ ...base, kind: "upc", terms: [], upc: "041604302046" });
    expect(upc).toHaveLength(1);
    expect(upc[0]!.match.reason).toBe("upc_exact");
    expect(upc[0]!.match.score).toBe(1);

    const none = await findRecallsForItem({ ...base, terms: ["kombucha"] });
    expect(none).toHaveLength(0);
  });

  it("respects category filters and down-ranks out-of-state distribution", async () => {
    const base = { id: "probe", userId: "u", kind: "product" as const, label: "x", upc: null, homeState: null, categories: [] };
    const foodOnly = await findRecallsForItem({ ...base, terms: ["chicken"], categories: ["food"] });
    expect(foodOnly).toHaveLength(0); // chicken recalls are veterinary + meat_poultry
    const meat = await findRecallsForItem({ ...base, terms: ["chicken"], categories: ["meat_poultry"] });
    expect(meat.map((m) => m.recall.sourceId)).toEqual(["PHA-10022026-01"]);

    const inState = await findRecallsForItem({ ...base, terms: ["green juice"], homeState: "CA" });
    const outOfState = await findRecallsForItem({ ...base, terms: ["green juice"], homeState: "NY" });
    expect(inState[0]!.match.score).toBeGreaterThan(outOfState[0]!.match.score);
    expect(outOfState[0]!.match.explanation).toContain("Not reported as distributed in NY");
  });

  it("alerts watchers when a new recall arrives (recall → watch items), once per user", async () => {
    const user = await prisma.user.create({ data: { installId: "i1", tokenHash: sha256("t1"), homeState: "TX" } });
    const other = await prisma.user.create({ data: { installId: "i2", tokenHash: sha256("t2") } });
    await prisma.watchItem.createMany({
      data: [
        { userId: user.id, kind: "product", label: "Pecans", terms: ["pecans"] },
        { userId: user.id, kind: "product", label: "Hill Country", terms: ["hill country snacks"] },
        { userId: other.id, kind: "upc", label: "Some mug", terms: [], upc: "041604302211" },
        { userId: other.id, kind: "product", label: "Unrelated", terms: ["kombucha"] },
      ],
    });
    const recalls = await prisma.recall.findMany({ where: { sourceId: { in: ["F-1399-2026", "27-001"] } } });
    const created = await matchRecalls(recalls, { notify: false });
    expect(created).toBe(2);
    const alerts = await prisma.alert.findMany({ include: { recall: true, watchItem: true }, orderBy: { score: "desc" } });
    const mug = alerts.find((a) => a.userId === other.id)!;
    expect(mug.reason).toBe("upc_exact");
    expect(mug.recall.sourceId).toBe("27-001");
    const pecans = alerts.find((a) => a.userId === user.id)!;
    expect(pecans.reason).toBe("brand_match"); // best of the two matching items wins
    expect(pecans.watchItem?.label).toBe("Hill Country");
    // Re-running does not duplicate.
    expect(await matchRecalls(recalls, { notify: false })).toBe(0);
  });

  it("matches category subscriptions by category, severity and the user's states", async () => {
    const tx = await prisma.user.create({ data: { installId: "sub-tx", tokenHash: sha256("sub-tx"), homeState: "TX" } });
    const ny = await prisma.user.create({ data: { installId: "sub-ny", tokenHash: sha256("sub-ny"), homeState: "NY" } });
    const any = await prisma.user.create({ data: { installId: "sub-any", tokenHash: sha256("sub-any") } });
    await prisma.watchItem.createMany({
      data: [
        { userId: tx.id, kind: "category", label: "All food recalls near me", terms: [], categories: ["food"], minSeverity: "unknown" },
        { userId: ny.id, kind: "category", label: "Critical food recalls near me", terms: [], categories: ["food"], minSeverity: "critical" },
        { userId: any.id, kind: "category", label: "Meat & poultry", terms: [], categories: ["meat_poultry"], minSeverity: "high" },
      ],
    });
    const recalls = await prisma.recall.findMany({ where: { sourceId: { in: ["F-1399-2026", "F-1456-2026", "PHA-10022026-01"] } } });
    await matchRecalls(recalls, { notify: false });
    const by = async (userId: string) => (await prisma.alert.findMany({ where: { userId }, include: { recall: true } })).map((a) => a.recall.sourceId).sort();
    // TX: pecans (low, sold in TX/OK) + Jif (critical, nationwide). NY: only Jif (critical; pecans not sold in NY and too low anyway).
    expect(await by(tx.id)).toEqual(["F-1399-2026", "F-1456-2026"]);
    expect(await by(ny.id)).toEqual(["F-1456-2026"]);
    // No state on file: distribution is not a filter. Public health alert is "high" meat_poultry.
    expect(await by(any.id)).toEqual(["PHA-10022026-01"]);
    const txAlert = await prisma.alert.findFirstOrThrow({ where: { userId: tx.id, recall: { sourceId: "F-1456-2026" } } });
    expect(txAlert.reason).toBe("category_subscription");
    expect(txAlert.explanation).toContain("Critical (Class I) food recall sold in TX");

    // Direction B gives a new subscriber the recent list right away.
    const probe = { id: "p", userId: ny.id, kind: "category" as const, label: "x", terms: [], upc: null, categories: ["food" as const], minSeverity: "high" as const, homeState: "CA" };
    const instant = await findRecallsForItem(probe, { lookbackDays: 365 });
    expect(instant.map((m) => m.recall.sourceId).sort()).toEqual(["F-1456-2026", "F-1460-2026"]); // juice (high) is sold in CA
  });

  it("scores deterministically", () => {
    const recall = {
      productDescription: "Acme Foods Crunchy Granola",
      company: "Acme Foods",
      brands: ["Acme"],
      category: "food",
      severity: "critical",
      distributionStates: ["CA"],
    } as never;
    const item = { id: "a", userId: "u", kind: "product" as const, label: "x", terms: ["acme"], upc: null, categories: [], homeState: "NY" };
    const m = scoreMatch(item, recall, ["acme"], false)!;
    expect(m.reason).toBe("brand_match");
    expect(m.score).toBeCloseTo(Math.min(1, 1 * 0.6 + 0.1), 2);
    expect(scoreMatch({ ...item, categories: ["drug"] }, recall, ["acme"], false)).toBeNull();
  });
});
