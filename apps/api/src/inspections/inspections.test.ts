import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db/client.js";
import { sha256 } from "../lib/crypto.js";
import { getOrCreateProfile } from "../premium/restaurantResearch.js";
import { resetDb } from "../test/db.js";
import { inspectionFixtureFetcher } from "./fixtureLoader.js";
import { compareLevels, interpretGrade } from "./grade.js";
import { runMaintenance } from "./maintenance.js";
import { nameSimilarity, pickBestVenue } from "./match.js";
import { ChicagoCdphAdapter, parseChicagoViolations } from "./sources/chicagoCdph.js";
import { NycDohmhAdapter, groupNycRows, nycUrl } from "./sources/nycDohmh.js";
import { syncGrade } from "./sync.js";

describe("grade interpretation and venue matching", () => {
  it("reads letter, points, pass/fail and score scales", () => {
    expect(interpretGrade("A", 9, "nyc_points")).toMatchObject({ level: "good" });
    expect(interpretGrade("C", 31, "nyc_points")).toMatchObject({ level: "poor" });
    expect(interpretGrade(null, 20, "nyc_points")).toMatchObject({ level: "ok", label: "20 points — B range" });
    expect(interpretGrade("Pass w/ Conditions", null, "pass_fail")).toMatchObject({ level: "ok" });
    expect(interpretGrade("Fail", null, "pass_fail").level).toBe("poor");
    expect(interpretGrade("94", 94, "score_100").level).toBe("good");
    expect(interpretGrade(null, 72, "score_100").level).toBe("poor");
    expect(interpretGrade(null, null, null)).toEqual({ level: "unknown", label: null });
    expect(compareLevels("good", "poor")).toBe("worse");
    expect(compareLevels("ok", "good")).toBe("better");
    expect(compareLevels("unknown", "good")).toBeNull();
  });

  it("matches venue names fuzzily and prefers the nearby one", () => {
    expect(nameSimilarity("Capitol Deli", "CAPITOL DELI")).toBe(1);
    expect(nameSimilarity("Joe's Crab Shack", "JOES CRAB SHACK RESTAURANT")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Capitol Deli", "Golden Wok")).toBeLessThan(0.4);
    const profile = { name: "Capitol Deli", latitude: 40.7075, longitude: -74.011 };
    const best = pickBestVenue(profile, [
      { name: "CAPITOL DELI & GRILL", latitude: 40.7282, longitude: -73.7949, id: "queens" },
      { name: "CAPITOL DELI", latitude: 40.7074, longitude: -74.0113, id: "manhattan" },
    ]);
    expect(best?.id).toBe("manhattan");
    expect(pickBestVenue({ name: "Totally Different", latitude: null, longitude: null }, [{ name: "CAPITOL DELI" }])).toBeNull();
  });
});

describe("open-data adapters (fixtures)", () => {
  it("NYC: groups violation rows into inspections, drops the 1900 placeholder, picks the right CAMIS", async () => {
    expect(nycUrl({ camis: "41234567" })).toContain("camis=41234567");
    expect(nycUrl({ name: "capitol deli" })).toContain("upper%28dba%29+like");
    const adapter = new NycDohmhAdapter(inspectionFixtureFetcher);
    expect(adapter.covers({ city: "Manhattan", state: "NY" })).toBe(true);
    expect(adapter.covers({ city: "Buffalo", state: "NY" })).toBe(false);
    const recs = await adapter.lookup({ name: "Capitol Deli", city: "Manhattan", state: "NY", latitude: 40.7075, longitude: -74.011, gradeExternalId: null });
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ source: "nyc_dohmh", externalId: "41234567", grade: "A", score: 9, scale: "nyc_points" });
    expect(recs[0]!.violations).toHaveLength(2);
    expect(recs[0]!.violations.find((v) => v.code === "02G")?.critical).toBe(true);
    expect(recs[0]!.violations.find((v) => v.code === "10F")?.critical).toBe(false);
    expect(recs[1]).toMatchObject({ grade: "C", score: 31 });
    const grouped = groupNycRows(await inspectionFixtureFetcher("https://data.cityofnewyork.us/resource/43nn-pn8j.json"));
    expect(grouped.some((g) => g.inspectedAt.getUTCFullYear() === 1900)).toBe(false);
  });

  it("Chicago: parses the violations blob and skips out-of-business rows", async () => {
    const v = parseChicagoViolations("22. PROPER COLD HOLDING TEMPERATURES - Comments: CHICKEN AT 52F. | 55. PHYSICAL FACILITIES - Comments: FLOOR SOILED.");
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ code: "22", critical: true });
    expect(v[0]!.description).toContain("CHICKEN AT 52F");
    expect(v[1]!.critical).toBe(false);
    const adapter = new ChicagoCdphAdapter(inspectionFixtureFetcher);
    expect(adapter.covers({ city: "Chicago", state: "IL" })).toBe(true);
    const recs = await adapter.lookup({ name: "Golden Wok", city: "Chicago", state: "IL", latitude: 41.9036, longitude: -87.6318, gradeExternalId: null });
    expect(recs.map((r) => r.grade)).toEqual(["Pass w/ Conditions", "Fail"]);
    expect(recs[0]!.externalId).toBe("2211234");
  });
});

describe("grade sync and catalog maintenance (integration)", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterAll(async () => prisma.$disconnect());

  it("stores inspections on the shared profile and notifies trackers only when the grade changes", async () => {
    const u1 = await prisma.user.create({ data: { installId: "g1", tokenHash: sha256("g1"), tier: "premium" } });
    const u2 = await prisma.user.create({ data: { installId: "g2", tokenHash: sha256("g2"), tier: "premium" } });
    const profile = await getOrCreateProfile({ name: "Capitol Deli", city: "Manhattan", state: "NY", latitude: 40.7075, longitude: -74.011 });
    await prisma.watchItem.createMany({ data: [u1, u2].map((u) => ({ userId: u.id, kind: "restaurant" as const, label: "Capitol Deli", terms: ["capitol deli"], restaurantProfileId: profile.id })) });

    // First sync: grade appears (A). An improvement/first good grade is recorded but not pushed.
    const first = await syncGrade(profile.id);
    expect(first).toMatchObject({ source: "nyc_dohmh", inspectionsStored: 2, previousGrade: null, currentGrade: "A", changed: true, noticesCreated: 2 });
    const p1 = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(p1).toMatchObject({ gradeSource: "nyc_dohmh", gradeExternalId: "41234567", currentGrade: "A", currentScore: 9, gradeScale: "nyc_points" });
    expect(await prisma.restaurantInspection.count({ where: { profileId: profile.id } })).toBe(2);
    expect(await prisma.restaurantNotice.count({ where: { kind: "grade_first" } })).toBe(2);

    // Same data again: idempotent, no new notices.
    const again = await syncGrade(profile.id);
    expect(again.changed).toBe(false);
    expect(await prisma.restaurantNotice.count()).toBe(2);

    // A new, worse inspection arrives (handed in as records, as the AI fallback would): both trackers get a grade_change notice.
    const worse = await syncGrade(profile.id, {
      source: "nyc_dohmh",
      records: [{ source: "nyc_dohmh", externalId: "41234567", inspectedAt: new Date("2026-10-01T00:00:00Z"), grade: "C", score: 35, scale: "nyc_points", inspectionType: "Cycle Inspection / Re-inspection", violations: [{ code: "04L", description: "Mice", critical: true }], sourceUrl: null }],
    });
    expect(worse).toMatchObject({ previousGrade: "A", currentGrade: "C", changed: true, noticesCreated: 2 });
    const notice = await prisma.restaurantNotice.findFirstOrThrow({ where: { userId: u1.id, kind: "grade_change" } });
    expect(notice.title).toContain("dropped to C");
    expect(notice.data).toMatchObject({ previousGrade: "A", currentGrade: "C", direction: "worse" });
    expect(await prisma.restaurantInspection.count({ where: { profileId: profile.id } })).toBe(3);
  });

  it("keeps shared data when users leave, and prunes only worthless profiles", async () => {
    const profile = await prisma.restaurantProfile.findFirstOrThrow({ where: { name: "Capitol Deli" } });
    await prisma.watchItem.deleteMany({ where: { restaurantProfileId: profile.id } });
    await prisma.user.deleteMany({ where: { installId: { in: ["g1", "g2"] } } });
    // Untracked now, but researched/graded: must survive maintenance.
    const junk = await prisma.restaurantProfile.create({ data: { key: "name:nobody cares||", name: "Nobody Cares", lastRequestedAt: new Date(Date.now() - 400 * 86_400_000) } });
    const recent = await prisma.restaurantProfile.create({ data: { key: "name:new place||", name: "New Place" } });
    const report = await runMaintenance({ research: false });
    expect(report.pruned).toBe(1);
    expect(await prisma.restaurantProfile.findUnique({ where: { id: profile.id } })).not.toBeNull();
    expect(await prisma.restaurantInspection.count({ where: { profileId: profile.id } })).toBe(3);
    expect(await prisma.restaurantProfile.findUnique({ where: { id: junk.id } })).toBeNull();
    expect(await prisma.restaurantProfile.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });

  it("refreshes stale grades for tracked restaurants on the maintenance run", async () => {
    const u = await prisma.user.create({ data: { installId: "g3", tokenHash: sha256("g3"), tier: "premium" } });
    const chi = await getOrCreateProfile({ name: "Golden Wok", city: "Chicago", state: "IL", latitude: 41.9036, longitude: -87.6318 });
    await prisma.watchItem.create({ data: { userId: u.id, kind: "restaurant", label: "Golden Wok", terms: ["golden wok"], restaurantProfileId: chi.id } });
    const elsewhere = await getOrCreateProfile({ name: "Tiny Town Diner", city: "Boise", state: "ID" });
    await prisma.watchItem.create({ data: { userId: u.id, kind: "restaurant", label: "Diner", terms: ["tiny town diner"], restaurantProfileId: elsewhere.id } });
    const report = await runMaintenance({ research: false });
    expect(report.gradesChecked).toBe(2);
    const chicago = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: chi.id } });
    expect(chicago).toMatchObject({ currentGrade: "Pass w/ Conditions", gradeScale: "pass_fail", gradeSource: "chicago_cdph" });
    const boise = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: elsewhere.id } });
    expect(boise.currentGrade).toBeNull();
    expect(boise.gradeError).toContain("No inspection data source");
    expect(boise.gradeCheckedAt).not.toBeNull();
    // Already checked today: not re-checked.
    expect((await runMaintenance({ research: false })).gradesChecked).toBe(0);
  });
});
