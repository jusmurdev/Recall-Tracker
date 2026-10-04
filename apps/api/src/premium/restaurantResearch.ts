/**
 * PREMIUM — research a restaurant's supply chain and food-safety signals, then watch for
 * recalls affecting the suppliers/ingredients found.
 *
 * Research is expensive (Claude + web search), so it is done ONCE per restaurant and stored
 * on a shared `RestaurantProfile`. Every user tracking that restaurant reuses the same
 * record until it is older than RESTAURANT_RESEARCH_TTL_DAYS. Supplier terms are copied onto
 * each user's watch item so the normal matching engine alerts them when a supplier is recalled.
 *
 * Uses Claude with the server-side web search tool (runs on Anthropic's infrastructure, so
 * we do no crawling ourselves).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { RestaurantProfile, WatchItem } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { findRecallsForItem, recordAlertsForItem, type RecallMatch } from "../matching/engine.js";
import { assertQuota, claude, model, parseJsonOutput, recordUsage, textOf } from "./claude.js";
import { syncGrade } from "../inspections/sync.js";
import { enqueueGradeSync } from "../jobs/queues.js";

export const Research = z.object({
  summary: z.string().describe("3-5 sentences a diner would want to know, plain language"),
  suppliers: z
    .array(z.object({ name: z.string(), kind: z.enum(["distributor", "producer", "brand", "ingredient"]), confidence: z.enum(["confirmed", "likely", "guess"]), sourceUrl: z.string().nullable() }))
    .max(30),
  riskSignals: z.array(z.object({ signal: z.string(), sourceUrl: z.string().nullable() })).max(20),
  sources: z.array(z.string()).max(30),
  /** Latest official health inspection result, when a published source states it. */
  inspection: z
    .object({
      grade: z.string().nullable().describe("As the jurisdiction expresses it: A/B/C, Pass/Fail, or a score"),
      score: z.number().int().nullable(),
      scale: z.enum(["letter_abc", "score_100", "pass_fail", "nyc_points"]).nullable(),
      date: z.string().nullable().describe("ISO date of the inspection"),
      sourceUrl: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type Research = z.infer<typeof Research>;

const SYSTEM = `You research restaurants for a consumer food-safety app. Given a restaurant, find:
1. Who supplies its food: named distributors (e.g. Sysco, US Foods, Gordon Food Service), producers, brands it advertises using, and signature ingredients. Menus, "about us" pages, press, supplier case studies, and job postings often name them. Mark each as confirmed (named by the restaurant or supplier), likely (strong indirect evidence) or guess.
2. Food-safety signals: health inspection results, closures, reported illnesses, and recurring review complaints about food safety (not taste or service).
3. The most recent official health inspection grade or score, with its date and the government page it came from (county/city health department sites). Leave it null if you cannot find an official source.
Be factual and cite the pages you relied on. If you cannot find something, say so rather than guessing. Do not include personal data about individuals.`;

export interface RestaurantIdentity {
  name: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Normalised identity so "Joe's Crab Shack, Austin TX" and "joes crab shack / austin / tx"
 * share one profile. A website host is the strongest signal when present.
 */
export function restaurantKey(r: RestaurantIdentity): string {
  if (r.website) {
    try {
      const host = new URL(r.website).hostname.toLowerCase().replace(/^www\./, "");
      if (host) return `host:${host}`;
    } catch {
      // fall through to name-based key
    }
  }
  const norm = (s: string | null | undefined) =>
    (s ?? "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(the|restaurant|cafe|café|grill|kitchen|bar|llc|inc)\b/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return `name:${norm(r.name)}|${norm(r.city)}|${(r.state ?? "").toUpperCase()}`;
}

export function isFresh(profile: Pick<RestaurantProfile, "researchStatus" | "researchedAt">, now = new Date()): boolean {
  if (profile.researchStatus !== "ready" || !profile.researchedAt) return false;
  return now.getTime() - profile.researchedAt.getTime() < env().RESTAURANT_RESEARCH_TTL_DAYS * 86_400_000;
}

export function canRefresh(profile: Pick<RestaurantProfile, "researchStatus" | "researchedAt">, now = new Date()): boolean {
  if (profile.researchStatus === "researching") return false;
  if (!profile.researchedAt) return true;
  return now.getTime() - profile.researchedAt.getTime() >= env().RESTAURANT_RESEARCH_MIN_REFRESH_DAYS * 86_400_000;
}

/** Find or create the shared profile for a restaurant. */
export async function getOrCreateProfile(r: RestaurantIdentity): Promise<RestaurantProfile> {
  const key = restaurantKey(r);
  return prisma.restaurantProfile.upsert({
    where: { key },
    create: { key, name: r.name, city: r.city ?? null, state: r.state?.toUpperCase() ?? null, website: r.website ?? null, latitude: r.latitude ?? null, longitude: r.longitude ?? null },
    update: {
      lastRequestedAt: new Date(),
      // Fill in details we did not have before; never overwrite known ones with blanks.
      ...(r.city ? { city: r.city } : {}),
      ...(r.state ? { state: r.state.toUpperCase() } : {}),
      ...(r.website ? { website: r.website } : {}),
      ...(typeof r.latitude === "number" && typeof r.longitude === "number" ? { latitude: r.latitude, longitude: r.longitude } : {}),
    },
  });
}

export interface ResearchOutcome {
  profile: RestaurantProfile;
  research: Research;
  supplierTerms: string[];
  /** Matches for the watch items updated in this pass (keyed by watch item id). */
  matchesByItem: Record<string, RecallMatch[]>;
  /** True when no AI call was made because the cached research was still fresh. */
  cached: boolean;
}

/**
 * Research a profile (unless a fresh result already exists) and apply it to every watch item
 * linked to it. The requesting user's AI quota is charged when the AI actually runs.
 */
export async function researchProfile(profileId: string, requestingUserId: string | null, client?: Anthropic): Promise<ResearchOutcome> {
  let profile = await prisma.restaurantProfile.findUniqueOrThrow({ where: { id: profileId } });
  if (isFresh(profile)) {
    // Another request finished first, or the cache is simply still good.
    const research = Research.parse(profile.researchJson);
    const matchesByItem = await applyProfileToItems(profile, research);
    return { profile, research, supplierTerms: profile.supplierTerms, matchesByItem, cached: true };
  }

  // System refreshes (maintenance job) are not charged to anyone.
  if (requestingUserId) await assertQuota(requestingUserId);
  await prisma.restaurantProfile.update({ where: { id: profileId }, data: { researchStatus: "researching", researchError: null } });
  try {
    const research = await runResearch(profile, requestingUserId, client ?? claude());
    const supplierTerms = extractSupplierTerms(research);
    profile = await prisma.restaurantProfile.update({
      where: { id: profileId },
      data: {
        researchStatus: "ready",
        summary: research.summary,
        supplierTerms,
        researchJson: research,
        researchedAt: new Date(),
        researchCount: { increment: 1 },
      },
    });
    const matchesByItem = await applyProfileToItems(profile, research);
    await applyInspectionFromResearch(profile, research);
    logger.info({ profileId, restaurant: profile.name, suppliers: supplierTerms.length, items: Object.keys(matchesByItem).length }, "restaurant research stored");
    return { profile, research, supplierTerms, matchesByItem, cached: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.restaurantProfile.update({
      where: { id: profileId },
      // Keep an older result usable if we had one; otherwise mark failed so the app can say so.
      data: { researchStatus: profile.researchedAt ? "ready" : "failed", researchError: message.slice(0, 500) },
    });
    throw err;
  }
}

/**
 * Jurisdictions without an open-data adapter still get a grade: whatever the research found on
 * an official page is stored through the same sync path (so change notices work), but it never
 * overrides a grade that came from a structured source.
 */
async function applyInspectionFromResearch(profile: RestaurantProfile, research: Research): Promise<void> {
  const insp = research.inspection;
  if (!insp || (!insp.grade && insp.score == null) || !insp.date) return;
  if (profile.gradeSource && profile.gradeSource !== "ai_research") return;
  const inspectedAt = new Date(insp.date);
  if (Number.isNaN(inspectedAt.getTime())) return;
  await syncGrade(profile.id, {
    source: "ai_research",
    records: [{ source: "ai_research", externalId: null, inspectedAt, grade: insp.grade, score: insp.score, scale: insp.scale ?? (insp.score != null ? "score_100" : "letter_abc"), inspectionType: null, violations: [], sourceUrl: insp.sourceUrl }],
  });
}

async function runResearch(profile: RestaurantProfile, userId: string | null, client: Anthropic): Promise<Research> {
  const where = [profile.city, profile.state].filter(Boolean).join(", ");
  const prompt = `Restaurant: ${profile.name}${where ? ` (${where})` : ""}${profile.website ? `\nWebsite: ${profile.website}` : ""}`;
  const tools: Anthropic.ToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: 8,
      user_location: { type: "approximate", country: "US", ...(profile.city ? { city: profile.city } : {}), ...(profile.state ? { region: profile.state } : {}) },
    },
  ];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let response = await client.messages.create({ model: model(), max_tokens: 16000, system: SYSTEM, tools, output_config: { format: zodOutputFormat(Research) }, messages });
  await recordUsage(userId, "restaurant_research", response.usage);

  // Long server-tool turns can pause; resume by echoing the assistant turn back.
  let resumes = 0;
  while (response.stop_reason === "pause_turn" && resumes < 3) {
    resumes += 1;
    messages.push({ role: "assistant", content: response.content });
    response = await client.messages.create({ model: model(), max_tokens: 16000, system: SYSTEM, tools, output_config: { format: zodOutputFormat(Research) }, messages });
    await recordUsage(userId, "restaurant_research", response.usage);
  }
  if (response.stop_reason === "refusal") throw new Error("The AI declined to research this restaurant.");
  return parseJsonOutput(textOf(response.content), (v) => Research.parse(v));
}

/** Confirmed/likely supplier names, lower-cased, minus words true of every kitchen. */
export function extractSupplierTerms(research: Research): string[] {
  return uniq(
    research.suppliers
      .filter((s) => s.confidence !== "guess")
      .map((s) => s.name.trim().toLowerCase())
      .filter((n) => n.length >= 3 && !GENERIC.has(n)),
  ).slice(0, 25);
}

/** Copy the profile's research onto every linked watch item that is missing or behind it, then match. */
export async function applyProfileToItems(profile: RestaurantProfile, research: Research): Promise<Record<string, RecallMatch[]>> {
  const items = await prisma.watchItem.findMany({
    where: { restaurantProfileId: profile.id, OR: [{ researchUpdatedAt: null }, { researchUpdatedAt: { lt: profile.researchedAt ?? new Date(0) } }] },
  });
  const out: Record<string, RecallMatch[]> = {};
  for (const item of items) out[item.id] = await applyProfileToItem(profile, research, item);
  return out;
}

/** Apply shared research to one watch item: merge terms, snapshot the summary, record alerts. */
export async function applyProfileToItem(profile: RestaurantProfile, research: Research, item: WatchItem): Promise<RecallMatch[]> {
  const base = item.terms.filter((t) => t.length >= 3 && !profile.supplierTerms.includes(t));
  const updated = await prisma.watchItem.update({
    where: { id: item.id },
    data: {
      terms: uniq([...base, ...profile.supplierTerms]),
      researchSummary: research.summary,
      researchUpdatedAt: profile.researchedAt ?? new Date(),
      researchJson: research,
    },
  });
  const user = await prisma.user.findUnique({ where: { id: item.userId }, select: { homeState: true } });
  const lite = { ...updated, homeState: user?.homeState ?? null, terms: profile.supplierTerms.length ? profile.supplierTerms : updated.terms };
  const matches = await findRecallsForItem(lite);
  await recordAlertsForItem(lite, matches);
  return matches;
}

/**
 * Called when a user adds a restaurant: link the item to the shared profile and either reuse
 * fresh research immediately (no AI call) or report that research is needed.
 */
export async function attachRestaurant(item: WatchItem, identity: RestaurantIdentity & { profileId?: string | null }): Promise<{ profile: RestaurantProfile; cached: boolean; matches: RecallMatch[] }> {
  // Picking from the shared catalog beats describing the place again: no duplicate profiles.
  const existing = identity.profileId ? await prisma.restaurantProfile.findUnique({ where: { id: identity.profileId } }) : null;
  const profile = existing
    ? await prisma.restaurantProfile.update({ where: { id: existing.id }, data: { lastRequestedAt: new Date() } })
    : await getOrCreateProfile(identity);
  if (!profile.gradeCheckedAt) await enqueueGradeSync(profile.id).catch((err) => logger.warn({ err }, "grade sync enqueue failed"));
  const linked = await prisma.watchItem.update({ where: { id: item.id }, data: { restaurantProfileId: profile.id } });
  if (isFresh(profile)) {
    const research = Research.parse(profile.researchJson);
    const matches = await applyProfileToItem(profile, research, linked);
    await prisma.restaurantProfile.update({ where: { id: profile.id }, data: { cacheHits: { increment: 1 } } });
    logger.info({ profileId: profile.id, watchItemId: item.id }, "restaurant research reused from cache");
    return { profile, cached: true, matches };
  }
  return { profile, cached: false, matches: [] };
}

/** Words that are true of every restaurant and would match everything. */
const GENERIC = new Set(["chicken", "beef", "pork", "fish", "rice", "bread", "cheese", "salt", "pepper", "oil", "flour", "sugar", "eggs", "egg", "milk", "butter", "water", "ice", "onion", "onions", "garlic", "tomato", "tomatoes", "lettuce", "produce", "meat", "seafood", "vegetables", "fruit"]);

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
