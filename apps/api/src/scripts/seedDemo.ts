/**
 * Seeds a demo premium user with a realistic set of data so the app has something to show:
 * watch items of every kind, alerts (read/unread/resolved), a researched + graded restaurant
 * with inspection history and a grade-drop notice, a connected account, and preferences.
 * Run after `ingest:fixtures`. Prints the bearer token (set DEMO_TOKEN to make it stable).
 */
import { prisma } from "../db/client.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { findRecallsForItem, recordAlertsForItem } from "../matching/engine.js";

const token = process.env.DEMO_TOKEN ?? randomToken();
const demoUser = { tokenHash: sha256(token), tier: "premium" as const, homeState: "CA", lastKnownState: "NY", timezone: "America/Los_Angeles", quietHoursStart: 22, quietHoursEnd: 7, dietProfiles: ["allergy_peanut", "allergy_milk", "gluten_free", "halal", "kosher", "vegan"], otherAllergens: ["mustard"] };
const user = await prisma.user.upsert({
  where: { installId: "demo-install" },
  create: { installId: "demo-install", ...demoUser },
  update: demoUser,
});

// Recalls that exercise every dietary profile (undeclared milk, undeclared peanuts, wheat/gluten,
// pork gelatin, alcohol, a kosher-certified product). Deterministic ids so re-seeding is idempotent.
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const dietRecalls = [
  { sourceId: "DEMO-DIET-MILK", company: "Harvest Lane Bakery", product: "Harvest Lane Oatmeal Raisin Cookies, 10 oz tray", reason: "Undeclared milk. The cookies contain whey protein that is not listed on the label; people with a milk allergy risk a serious reaction.", category: "food" as const, severity: "critical" as const, states: ["US"], days: 2, code: "Best by 11/2026 through 01/2027; lot 24A-24K", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-PEANUT", company: "Sierra Trail Co.", product: "Sierra Trail Dark Chocolate Granola Bars, 6 count box", reason: "Undeclared peanuts. A supplier shipped peanut pieces labeled as sunflower seeds; peanut was not declared on the package.", category: "food" as const, severity: "critical" as const, states: ["CA", "NV", "AZ", "OR", "WA"], days: 4, code: "UPC 0 71234 55512 9; best by dates 03/15/2027 and 03/22/2027", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-GLUTEN", company: "Northfield Pasta Works", product: "Northfield Gluten-Free Penne, 12 oz bag", reason: "Mislabeled: bags marked gluten-free were filled with semolina (wheat) penne. People with celiac disease or a wheat allergy should not eat it.", category: "food" as const, severity: "high" as const, states: ["US"], days: 6, code: "Lot NF2261 and NF2262, best by 09/2027", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-GELATIN", company: "Bright Bite Confections", product: "Bright Bite Fruit Chews, 8 oz bag (made with pork gelatin)", reason: "Undeclared pork-derived gelatin; the ingredient statement lists gelatin without its source. Also undeclared yellow 5.", category: "food" as const, severity: "low" as const, states: ["US"], days: 9, code: "Lots BB-0911 through BB-0930", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-ALCOHOL", company: "Vineyard Kitchen LLC", product: "Vineyard Kitchen Red Wine Marinara Sauce, 24 oz jar", reason: "Product contains alcohol (red wine) that is not declared on the front label, and may have been sold as alcohol-free.", category: "food" as const, severity: "low" as const, states: ["NY", "NJ", "CT", "PA"], days: 12, code: "Jars coded 26-2201 to 26-2240", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-VEGAN", company: "Green Fields Foods", product: "Green Fields Plant-Based Mayo, 12 oz jar", reason: "Undeclared egg. Jars labeled vegan were filled with egg-based mayonnaise; the product contains egg and is not plant-based.", category: "food" as const, severity: "high" as const, states: ["US"], days: 7, code: "Best by 02/2027, lots GF-301 to GF-318", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
  { sourceId: "DEMO-DIET-KOSHER", company: "Shalom Foods Inc.", product: "Shalom Foods Orthodox Union (OU-D) Certified Chocolate Rugelach, 12 oz", reason: "Undeclared almonds (tree nuts). Product is kosher-certified by the Orthodox Union; the almond ingredient was omitted from the label.", category: "food" as const, severity: "high" as const, states: ["NY", "NJ", "FL", "CA", "IL"], days: 14, code: "Sell by 10/30/2026 and 11/06/2026", url: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts" },
];
for (const r of dietRecalls) {
  const data = {
    source: "FDA" as const, sourceId: r.sourceId, title: `${r.company}: ${r.product}`, summary: `${r.reason} Distribution: ${r.states.includes("US") ? "Nationwide" : r.states.join(", ")}.`,
    productDescription: r.product, reason: r.reason, category: r.category, severity: r.severity, status: "ongoing" as const, company: r.company, brands: [r.company.split(" ").slice(0, 2).join(" ")],
    upcs: [] as string[], distributionStates: r.states, recallDate: daysAgo(r.days + 1), publishedAt: daysAgo(r.days), url: r.url, imageUrls: [] as string[], codeInfo: r.code,
    remedy: "Check the codes on your package. If they match, do not eat the product; return it to the store for a refund or throw it away. Contact the company with questions.",
    contentHash: `demo-${r.sourceId.toLowerCase()}`, raw: {},
  };
  await prisma.recall.upsert({ where: { source_sourceId: { source: "FDA", sourceId: r.sourceId } }, create: data, update: data });
}
await prisma.alert.deleteMany({ where: { userId: user.id } });
await prisma.watchItem.deleteMany({ where: { userId: user.id } });
await prisma.restaurantNotice.deleteMany({ where: { userId: user.id } });
await prisma.connector.deleteMany({ where: { userId: user.id } });

const items = [
  { kind: "product" as const, label: "Jif peanut butter", terms: ["jif", "peanut butter"], context: "Costco, 2 jars in the pantry" },
  { kind: "product" as const, label: "Boar's Head deli meats", terms: ["boar's head", "liverwurst"] },
  { kind: "upc" as const, label: "Stanley travel mug", terms: ["stanley"], upc: "041604302046", importedFrom: "amazon" },
  { kind: "scan" as const, label: "Sunny Valley green juice", terms: ["sunny valley", "green juice"], ocrText: "SUNNY VALLEY\nCOLD-PRESSED GREEN JUICE\n12 FL OZ", context: "scanned at Whole Foods" },
  { kind: "product" as const, label: "Dog food (freeze-dried)", terms: ["freeze-dried", "dog food"], categories: ["veterinary" as const] },
  { kind: "category" as const, label: "Critical food recalls near me", terms: [], categories: ["food" as const, "meat_poultry" as const], minSeverity: "critical" as const },
];
const lite = { homeState: user.homeState, lastKnownState: user.lastKnownState };
for (const it of items) {
  const wi = await prisma.watchItem.create({ data: { userId: user.id, ...it } });
  const matches = await findRecallsForItem({ ...wi, ...lite });
  await recordAlertsForItem({ ...wi, ...lite }, matches);
}

// Restaurant: shared profile with research, grade history and a recent grade drop.
const profile = await prisma.restaurantProfile.upsert({
  where: { key: "name:capitol deli|manhattan|NY" },
  create: {
    key: "name:capitol deli|manhattan|NY", name: "Capitol Deli", city: "Manhattan", state: "NY", website: "https://capitoldeli.example.com", latitude: 40.7074, longitude: -74.0113,
    researchStatus: "ready", researchedAt: new Date(Date.now() - 12 * 86_400_000), researchCount: 1, cacheHits: 7,
    summary: "A classic Financial District deli known for its liverwurst and pastrami. The menu names Boar's Head as its cold-cut brand and a job posting mentions Sysco deliveries. One 2026 inspection cited mice; the most recent re-inspection restored an A.",
    supplierTerms: ["boar's head", "sysco"],
    researchJson: { summary: "Classic deli.", suppliers: [{ name: "Boar's Head", kind: "brand", confidence: "confirmed", sourceUrl: "https://capitoldeli.example.com/menu" }, { name: "Sysco", kind: "distributor", confidence: "likely", sourceUrl: null }], riskSignals: [{ signal: "March 2026 inspection: evidence of mice (critical), grade C", sourceUrl: "https://a816-health.nyc.gov/ABCEatsRestaurants" }], sources: ["https://capitoldeli.example.com/menu", "https://a816-health.nyc.gov/ABCEatsRestaurants"] },
    gradeSource: "nyc_dohmh", gradeExternalId: "41234567", currentGrade: "B", currentScore: 18, gradeScale: "nyc_points", lastInspectedAt: new Date("2026-10-01"), gradeCheckedAt: new Date(),
  },
  update: { currentGrade: "B", currentScore: 18, gradeCheckedAt: new Date(), lastInspectedAt: new Date("2026-10-01") },
});
await prisma.restaurantInspection.deleteMany({ where: { profileId: profile.id } });
await prisma.restaurantInspection.createMany({
  data: [
    { profileId: profile.id, source: "nyc_dohmh", inspectedAt: new Date("2026-10-01"), grade: "B", score: 18, inspectionType: "Cycle Inspection / Initial Inspection", violations: [{ code: "02G", description: "Cold food item held above 41ºF (smoked fish and reduced oxygen packaged foods above 38ºF) except during necessary preparation.", critical: true }, { code: "10F", description: "Non-food contact surface improperly constructed. Unacceptable material used.", critical: false }, { code: "06D", description: "Food contact surface not properly washed, rinsed and sanitized after each use.", critical: true }], sourceUrl: "https://a816-health.nyc.gov/ABCEatsRestaurants/#!/Search?camis=41234567" },
    { profileId: profile.id, source: "nyc_dohmh", inspectedAt: new Date("2026-04-14"), grade: "A", score: 9, inspectionType: "Cycle Inspection / Re-inspection", violations: [{ code: "10F", description: "Non-food contact surface improperly constructed.", critical: false }], sourceUrl: "https://a816-health.nyc.gov/ABCEatsRestaurants/#!/Search?camis=41234567" },
    { profileId: profile.id, source: "nyc_dohmh", inspectedAt: new Date("2026-03-02"), grade: "C", score: 31, inspectionType: "Cycle Inspection / Initial Inspection", violations: [{ code: "04L", description: "Evidence of mice or live mice present in facility's food and/or non-food areas.", critical: true }, { code: "02B", description: "Hot food item not held at or above 140ºF.", critical: true }], sourceUrl: "https://a816-health.nyc.gov/ABCEatsRestaurants/#!/Search?camis=41234567" },
  ],
});
const restaurant = await prisma.watchItem.create({
  data: { userId: user.id, kind: "restaurant", label: "Capitol Deli", terms: ["capitol deli", "boar's head", "sysco"], restaurantName: "Capitol Deli", restaurantCity: "Manhattan", restaurantState: "NY", restaurantProfileId: profile.id, context: "Lunch spot near the office", researchSummary: profile.summary, researchUpdatedAt: profile.researchedAt, researchJson: profile.researchJson ?? undefined },
});
const rMatches = await findRecallsForItem({ ...restaurant, ...lite, terms: profile.supplierTerms });
await recordAlertsForItem({ ...restaurant, ...lite }, rMatches);
await prisma.restaurantNotice.create({ data: { userId: user.id, profileId: profile.id, kind: "grade_change", title: "Capitol Deli: health grade dropped to B", body: "B — some violations (was A) · inspected 2026-10-01.", data: { previousGrade: "A", currentGrade: "B", direction: "worse" }, pushedAt: new Date() } });

// A second catalog restaurant nobody tracks yet (shows up in search / nearby).
await prisma.restaurantProfile.upsert({
  where: { key: "name:golden wok|chicago|IL" },
  create: { key: "name:golden wok|chicago|IL", name: "Golden Wok", city: "Chicago", state: "IL", latitude: 41.9036, longitude: -87.6318, researchStatus: "ready", researchedAt: new Date(), summary: "Neighborhood Chinese restaurant.", supplierTerms: [], researchJson: { summary: "x", suppliers: [], riskSignals: [], sources: [] }, gradeSource: "chicago_cdph", currentGrade: "Pass w/ Conditions", gradeScale: "pass_fail", lastInspectedAt: new Date("2026-09-20"), gradeCheckedAt: new Date() },
  update: {},
});

// Neighbours on the map around Capitol Deli (lower Manhattan), as open-data discovery would create them.
const neighbours = [
  { name: "Harbor Oyster Bar", address: "12 Stone St", lat: 40.7041, lng: -74.0119, grade: "A", score: 7, insp: "2026-09-12" },
  { name: "Fulton Street Pizza", address: "88 Fulton St", lat: 40.7095, lng: -74.0063, grade: "B", score: 21, insp: "2026-08-28" },
  { name: "Wall St Ramen", address: "40 Wall St", lat: 40.7065, lng: -74.0092, grade: "C", score: 34, insp: "2026-09-30" },
  { name: "Trinity Place Cafe", address: "100 Trinity Pl", lat: 40.7086, lng: -74.0128, grade: "A", score: 11, insp: "2026-07-19" },
  { name: "Battery Park Tacos", address: "17 Battery Pl", lat: 40.7049, lng: -74.0164, grade: null, score: null, insp: null },
  { name: "Pearl Street Noodles", address: "54 Pearl St", lat: 40.7034, lng: -74.0103, grade: "Z", score: 19, insp: "2026-09-25" },
];
for (const n of neighbours) {
  const p = await prisma.restaurantProfile.upsert({
    where: { key: `name:${n.name.toLowerCase().replace(/[^a-z0-9 ]/g, "")}|manhattan|NY` },
    create: { key: `name:${n.name.toLowerCase().replace(/[^a-z0-9 ]/g, "")}|manhattan|NY`, name: n.name, city: "Manhattan", state: "NY", address: n.address, latitude: n.lat, longitude: n.lng, gradeSource: n.grade ? "nyc_dohmh" : null, gradeExternalId: n.grade ? `5${Math.round(n.lat * 1e4)}` : null, currentGrade: n.grade, currentScore: n.score, gradeScale: n.grade ? "nyc_points" : null, lastInspectedAt: n.insp ? new Date(n.insp) : null, gradeCheckedAt: new Date() },
    update: { address: n.address, latitude: n.lat, longitude: n.lng, currentGrade: n.grade, currentScore: n.score, gradeScale: n.grade ? "nyc_points" : null, lastInspectedAt: n.insp ? new Date(n.insp) : null },
  });
  if (n.insp) {
    await prisma.restaurantInspection.upsert({
      where: { profileId_source_inspectedAt: { profileId: p.id, source: "nyc_dohmh", inspectedAt: new Date(n.insp) } },
      create: { profileId: p.id, source: "nyc_dohmh", inspectedAt: new Date(n.insp), grade: n.grade, score: n.score, inspectionType: "Cycle Inspection / Initial Inspection", violations: n.grade === "C" ? [{ code: "04L", description: "Evidence of mice or live mice present in facility's food and/or non-food areas.", critical: true }] : [], sourceUrl: null },
      update: {},
    });
  }
}
await prisma.restaurantProfile.update({ where: { id: profile.id }, data: { address: "100 Broadway" } });

await prisma.connector.create({ data: { userId: user.id, provider: "instacart", displayName: "My Instacart", mcpUrl: "https://mcp.instacart.example.com/mcp", lastSyncAt: new Date(Date.now() - 3 * 86_400_000), lastSyncStatus: "ok" } });

// Diet alerts: what the profile above matches among recent recalls (no push: the user is looking).
const { backfillDietAlerts } = await import("../diet/alerts.js");
const dietAlerts = await backfillDietAlerts(user);

// Make the inbox look lived-in: one read, one resolved.
const alerts = await prisma.alert.findMany({ where: { userId: user.id }, orderBy: { score: "desc" } });
if (alerts[1]) await prisma.alert.update({ where: { id: alerts[1].id }, data: { readAt: new Date() } });
if (alerts[2]) await prisma.alert.update({ where: { id: alerts[2].id }, data: { readAt: new Date(), resolvedAt: new Date(), resolvedAction: "returned" } });

console.log(JSON.stringify({ userId: user.id, token, watchItems: items.length + 1, alerts: alerts.length, dietAlerts, restaurantWatchItemId: restaurant.id }, null, 2));
await prisma.$disconnect();
