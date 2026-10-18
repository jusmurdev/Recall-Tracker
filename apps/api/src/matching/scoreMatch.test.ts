import type { Recall } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
// scoreMatch is pure; isolate it from generated Prisma client / database setup.
vi.mock("@prisma/client", () => ({ Prisma: {}, PrismaClient: class {} }));
import { scoreMatch } from "./engine.js";

const recall = (over: Partial<Recall> = {}) => ({
  title: "Acme Foods: Original Snack Mix",
  productDescription: "Original Snack Mix",
  company: "Acme Foods",
  brands: ["Acme"],
  category: "food",
  severity: "high",
  distributionStates: [],
  ...over,
}) as Recall;

const item = (over: Record<string, unknown> = {}) => ({
  id: "item",
  userId: "user",
  kind: "product",
  label: "Acme snack mix",
  terms: ["acme"],
  upc: null,
  categories: [],
  homeState: null,
  lastKnownState: null,
  ...over,
});

describe("scoreMatch policy", () => {
  it("gives an exact UPC a full-confidence match without text terms", () => {
    expect(scoreMatch(item({ kind: "upc", upc: "00012345678905" }), recall(), [], true)).toMatchObject({
      reason: "upc_exact",
      score: 1,
    });
  });

  it("rejects a lone generic scan term but keeps a capped low-confidence watch match", () => {
    const genericRecall = recall({ company: "Dairy Co", brands: [], productDescription: "Whole Milk" });
    expect(scoreMatch(item({ kind: "scan", terms: ["milk"] }), genericRecall, ["milk"], false)).toBeNull();
    expect(scoreMatch(item({ kind: "product", terms: ["milk"] }), genericRecall, ["milk"], false)?.score).toBeLessThanOrEqual(0.6);
  });

  it("drops a single coincidental distinctive word from scans and caps it for watch items", () => {
    const unrelated = recall({ company: "Valley Foods", brands: ["Valley"], productDescription: "Crispy potato chips" });
    const terms = ["prairie", "crunch"];
    expect(scoreMatch(item({ kind: "scan", terms }), unrelated, ["crunch"], false)).toBeNull();
    expect(scoreMatch(item({ kind: "product", terms }), unrelated, ["crunch"], false)?.score).toBe(0.4);
  });

  it("applies category filters and down-ranks recalls not distributed in the user's states", () => {
    const acme = recall({ distributionStates: ["CA"] });
    expect(scoreMatch(item({ categories: ["drug"] }), acme, ["acme"], false)).toBeNull();
    const local = scoreMatch(item({ homeState: "CA" }), acme, ["acme"], false)!;
    const outOfState = scoreMatch(item({ homeState: "NY" }), acme, ["acme"], false)!;
    expect(local.score).toBeGreaterThan(outOfState.score);
    expect(outOfState.explanation).toContain("Not reported as distributed in NY");
  });
});
