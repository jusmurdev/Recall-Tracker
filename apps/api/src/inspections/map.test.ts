import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../api/app.js";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { resetDb } from "../test/db.js";
import { discoverAround } from "./discover.js";
import { inspectionFixtureFetcher } from "./fixtureLoader.js";
import { safetyRating } from "./grade.js";
import { ChicagoCdphAdapter } from "./sources/chicagoCdph.js";
import { NycDohmhAdapter, nycUrl } from "./sources/nycDohmh.js";

const adapters = [new NycDohmhAdapter(inspectionFixtureFetcher), new ChicagoCdphAdapter(inspectionFixtureFetcher)];

describe("safety rating", () => {
  it("rates from the grade, then docks for recall exposure, and refuses to invent a number", () => {
    expect(safetyRating({ currentGrade: "A", currentScore: 9, gradeScale: "nyc_points" }, 0)).toMatchObject({ stars: 5, level: "good" });
    expect(safetyRating({ currentGrade: "A", currentScore: 9, gradeScale: "nyc_points" }, 2)).toMatchObject({ stars: 4, level: "good" });
    expect(safetyRating({ currentGrade: "B", currentScore: 18, gradeScale: "nyc_points" }, 1, 1)).toMatchObject({ stars: 2.5, level: "poor" });
    expect(safetyRating({ currentGrade: "Fail", currentScore: null, gradeScale: "pass_fail" }, 0)).toMatchObject({ stars: 2, level: "poor" });
    expect(safetyRating({ currentGrade: "C", currentScore: 40, gradeScale: "nyc_points" }, 5)).toMatchObject({ stars: 1 });
    expect(safetyRating({ currentGrade: null, currentScore: null, gradeScale: null }, 1)).toMatchObject({ stars: null, level: "unknown" });
  });
});

describe("area discovery (fixtures)", () => {
  it("NYC: builds a bounding-box query and returns one venue per CAMIS with its latest grade", async () => {
    expect(nycUrl({ box: { minLat: 40.7, maxLat: 40.71, minLng: -74.02, maxLng: -74.0 } })).toContain("latitude+between+40.7+and+40.71");
    const nyc = adapters[0]!;
    expect(nyc.coversPoint(40.7074, -74.0113)).toBe(true);
    expect(nyc.coversPoint(41.9, -87.6)).toBe(false);
    const venues = await nyc.discover(40.7074, -74.0113, 2);
    expect(venues).toHaveLength(1); // the Queens sibling is ~20 km away
    expect(venues[0]).toMatchObject({ externalId: "41234567", name: "Capitol Deli", city: "Manhattan", state: "NY", address: "100 Broadway" });
    expect(venues[0]!.latest).toMatchObject({ grade: "A", score: 9 });
    expect((await nyc.discover(40.7074, -74.0113, 30)).map((v) => v.name).sort()).toEqual(["Capitol Deli", "Capitol Deli & Grill"]);
  });
  it("Chicago: within_circle query, latest result per license, out-of-business rows skipped", async () => {
    const chi = adapters[1]!;
    const venues = await chi.discover(41.9036, -87.6318, 1);
    expect(venues.map((v) => v.name)).toEqual(["Golden Wok", "Golden Wok Express"]); // fixture ignores the circle; both have coords
    expect(venues[0]!.latest?.grade).toBe("Pass w/ Conditions");
  });
});

describe("map (integration)", () => {
  let app: FastifyInstance;
  let token: string;
  beforeAll(async () => {
    await resetDb();
    await ingestSource("FSIS", { now: new Date("2026-10-04T12:00:00Z") });
    app = await buildApp({ logger: false });
    token = (await app.inject({ method: "POST", url: "/v1/auth/anonymous", payload: { installId: "map-user-1", platform: "ios" } })).json().token;
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  const auth = () => ({ authorization: `Bearer ${token}` });

  it("discovers graded venues into the catalog once per cell, then serves them with ratings", async () => {
    const first = await discoverAround(40.7074, -74.0113, 2, { adapters });
    expect(first).toMatchObject({ source: "nyc_dohmh", fetched: 1, created: 1, updated: 0, cached: false });
    const again = await discoverAround(40.7074, -74.0113, 2, { adapters });
    expect(again.cached).toBe(true);
    const profile = await prisma.restaurantProfile.findFirstOrThrow({ where: { gradeExternalId: "41234567" } });
    expect(profile).toMatchObject({ name: "Capitol Deli", currentGrade: "A", gradeSource: "nyc_dohmh", address: "100 Broadway" });
    expect(await prisma.restaurantInspection.count({ where: { profileId: profile.id } })).toBe(1);

    // A user-added profile for the same place merges rather than duplicating, and keeps its pin.
    await prisma.restaurantProfile.update({ where: { id: profile.id }, data: { latitude: 40.70745, longitude: -74.0112, supplierTerms: ["boar's head"] } });
    const forced = await discoverAround(40.7074, -74.0113, 2, { adapters, force: true });
    expect(forced).toMatchObject({ created: 0, updated: 1 });
    expect((await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profile.id } })).latitude).toBe(40.70745);

    const res = await app.inject({ method: "GET", url: "/v1/restaurants/map?lat=40.7074&lng=-74.0113&radiusKm=2&discover=false", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ name: "Capitol Deli", grade: { grade: "A", level: "good" }, activeRecalls: 1, rating: { stars: 4.5, level: "good" }, trackedBy: 0, watchItemId: null });
    expect(body.items[0].rating.reason).toContain("1 active supplier recall");
    expect(body.items[0].distanceKm).toBeLessThan(0.1);
    expect(body.discovery).toEqual({ source: null, fetched: 0, cached: false });

    const far = await app.inject({ method: "GET", url: "/v1/restaurants/map?lat=40.75&lng=-73.98&radiusKm=1&discover=false", headers: auth() });
    expect(far.json().items).toHaveLength(0);

    const page = await app.inject({ method: "GET", url: `/v1/restaurants/${profile.id}`, headers: auth() });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ name: "Capitol Deli", rating: { stars: 4.5 }, activeRecalls: 1, researched: false, watchItemId: null });
    expect(page.json().inspections).toHaveLength(1);
    expect(page.json().matchedRecalls[0].recall.sourceId).toBe("031-2026");
    expect((await app.inject({ method: "GET", url: "/v1/restaurants/nope", headers: auth() })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/restaurants/map?lat=91&lng=0", headers: auth() })).statusCode).toBe(400);
  });
});
