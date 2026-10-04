import { Prisma, type Recall, type WatchItem } from "@prisma/client";
import type { MatchReason } from "@recall/shared";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { enqueuePushForAlerts } from "../jobs/queues.js";
import { isGenericTerm, termWeight } from "../scan/terms.js";
import { normalizeGtin } from "../scan/gtin.js";

/** Alerts below this score are stored (visible in the inbox) but not pushed. */
export const PUSH_THRESHOLD = 0.5;
/** Fuzzy term match strictness for pg_trgm word_similarity (0..1). */
const FUZZY_THRESHOLD = 0.72;
/** Only consider recalls from the last N days when a new watch item is created. */
const LOOKBACK_DAYS = 180;

export interface Match {
  reason: MatchReason;
  score: number;
  explanation: string;
  matchedTerms: string[];
}

/** Text a recall is matched against. Lower-cased once; stored nowhere. */
export function recallText(r: Pick<Recall, "title" | "productDescription" | "company" | "brands" | "summary">): string {
  return [r.title, r.productDescription, r.company, r.brands.join(" "), r.summary].join(" \n ").toLowerCase();
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type WatchItemLite = Pick<WatchItem, "id" | "userId" | "kind" | "label" | "terms" | "upc" | "categories"> & {
  homeState: string | null;
  minSeverity?: WatchItem["minSeverity"];
  /** Where the phone last reported being (travel); treated like a second home state. */
  lastKnownState?: string | null;
};

/**
 * Score a (watch item, recall) pair given the terms that matched. Deterministic and cheap so
 * it can run for both directions.
 */
export function scoreMatch(item: WatchItemLite, recall: Recall, matchedTerms: string[], upcHit: boolean): Match | null {
  const categories = item.categories ?? [];
  if (categories.length && !categories.includes(recall.category)) return null;

  let reason: MatchReason;
  let score: number;
  let explanation: string;

  if (upcHit && item.upc) {
    reason = "upc_exact";
    score = 1;
    explanation = `Barcode ${item.upc} is listed in this recall.`;
  } else if (matchedTerms.length) {
    // A generic word on its own ("milk", "dog food") describes a kind of product, not a product.
    // Every dairy recall mentions milk, so such a hit is noise unless something distinctive
    // matched alongside it.
    const distinctive = matchedTerms.filter((t) => !isGenericTerm(t));
    const genericOnly = !distinctive.length;
    if (genericOnly && item.kind === "scan") return null;
    const lowerCompany = recall.company.toLowerCase();
    const lowerBrands = recall.brands.map((b) => b.toLowerCase());
    // Brand names lead product descriptions ("Jif Creamy Peanut Butter…"), so the first few
    // words of the description count as brand territory alongside company + extracted brands.
    const lead = recall.productDescription.toLowerCase().slice(0, 40);
    const companyHit = distinctive.some((t) => lowerCompany.includes(t) || lowerBrands.some((b) => b.includes(t) || t.includes(b)));
    const leadHit = !companyHit && distinctive.some((t) => lead.includes(t));
    const brandHit = companyHit || leadHit;
    // Weighted coverage: phrases and brand-like words count, generic words barely do.
    const total = item.terms.reduce((acc, t) => acc + termWeight(t), 0) || 1;
    const hit = matchedTerms.reduce((acc, t) => acc + termWeight(t), 0);
    const coverage = Math.min(1, hit / total);
    const shown = [...distinctive, ...matchedTerms.filter((t) => isGenericTerm(t))].slice(0, 3).join(", ");
    const companyHitOrGeneric = companyHit;
    if (item.kind === "restaurant") {
      reason = "restaurant_supplier";
      score = 0.55 + 0.3 * coverage;
      explanation = `${item.label}: a supplier or ingredient we found (${shown}) appears in this recall.`;
    } else if (item.kind === "scan") {
      reason = "scan_text_match";
      score = (brandHit ? 0.7 : 0.5) + 0.3 * coverage;
      explanation = `Label text you scanned (${shown}) matches this recall.`;
    } else if (brandHit) {
      reason = "brand_match";
      // A hit on the recalling company / extracted brand list outranks the weaker
      // "appears at the start of the product description" heuristic, so ties resolve deterministically.
      score = (companyHit ? 0.75 : 0.7) + 0.25 * coverage;
      explanation = `Brand/company match on ${shown}.`;
    } else {
      reason = "text_match";
      score = 0.45 + 0.4 * coverage;
      explanation = `Product description mentions ${shown}.`;
    }
    // Someone who deliberately watches "milk" still hears about milk recalls, just never as a
    // top-confidence match.
    if (genericOnly && !companyHitOrGeneric) score = Math.min(score, 0.6);
  } else {
    return null;
  }

  // Down-rank recalls not distributed where the user lives or currently is (never suppress:
  // distribution lists are incomplete and people travel).
  const userStates = [...new Set([item.homeState, item.lastKnownState].filter((s): s is string => !!s))];
  if (userStates.length && recall.distributionStates.length && !recall.distributionStates.includes("US") && !userStates.some((s) => recall.distributionStates.includes(s))) {
    score *= 0.6;
    explanation += ` Not reported as distributed in ${userStates.join(" or ")}.`;
  }
  // Severity nudges push-worthiness.
  if (recall.severity === "critical") score = Math.min(1, score + 0.1);
  if (recall.severity === "low") score -= 0.1;

  return { reason, score: round(Math.max(0, Math.min(1, score))), explanation, matchedTerms };
}

interface CandidateRow {
  id: string;
  userId: string;
  kind: WatchItem["kind"];
  label: string;
  terms: string[];
  upc: string | null;
  categories: WatchItem["categories"];
  homeState: string | null;
  lastKnownState: string | null;
  matched_terms: string[];
  upc_hit: boolean;
}

/**
 * Direction A — new/changed recalls arrive: find every watch item they concern, create alerts,
 * and queue pushes. Returns the number of alerts created.
 */
export async function matchRecalls(recalls: Recall[], opts: { notify?: boolean } = {}): Promise<number> {
  const notify = opts.notify ?? true;
  let created = 0;
  const toPush: string[] = [];

  for (const recall of recalls) {
    const text = recallText(recall);
    const plain = normalizeForMatch(text);
    const recallGtins = recall.upcs.map(normalizeGtin);
    // A term matches when it appears verbatim, appears after stripping punctuation
    // ("boars head" vs "Boar's Head"), or is trigram-similar to a substring of the text.
    const termMatches = Prisma.sql`
          ${text} LIKE '%' || replace(replace(replace(lower(t), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
             OR ${plain} LIKE '%' || regexp_replace(lower(t), '[^a-z0-9 ]', '', 'g') || '%'
             OR (length(t) >= 4 AND word_similarity(lower(t), ${text}) >= ${FUZZY_THRESHOLD})`;
    const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT wi.id, wi."userId", wi.kind, wi.label, wi.terms, wi.upc, wi.categories, u."homeState", u."lastKnownState",
        ARRAY(
          SELECT t FROM unnest(wi.terms) AS t
          WHERE length(regexp_replace(lower(t), '[^a-z0-9 ]', '', 'g')) >= 2 AND (${termMatches})
        )::text[] AS matched_terms,
        (wi.upc IS NOT NULL AND lpad(wi.upc, 14, '0') = ANY(${recallGtins}::text[])) AS upc_hit
      FROM "WatchItem" wi
      JOIN "User" u ON u.id = wi."userId"
      WHERE (wi.upc IS NOT NULL AND lpad(wi.upc, 14, '0') = ANY(${recallGtins}::text[]))
         OR EXISTS (
          SELECT 1 FROM unnest(wi.terms) AS t
          WHERE length(regexp_replace(lower(t), '[^a-z0-9 ]', '', 'g')) >= 2 AND (${termMatches})
        )
    `);

    // Best match per user (one alert per user+recall).
    const best = new Map<string, { row: CandidateRow; match: Match }>();
    for (const row of rows) {
      const match = scoreMatch(row, recall, row.matched_terms.map((t) => t.toLowerCase()), row.upc_hit);
      if (!match) continue;
      const prev = best.get(row.userId);
      if (!prev || match.score > prev.match.score) best.set(row.userId, { row, match });
    }
    if (!best.size) continue;

    const data = [...best.values()].map(({ row, match }) => ({
      userId: row.userId,
      recallId: recall.id,
      watchItemId: row.id,
      reason: match.reason,
      score: match.score,
      explanation: match.explanation,
    }));
    const res = await prisma.alert.createMany({ data, skipDuplicates: true });
    created += res.count;
    if (res.count) {
      const fresh = await prisma.alert.findMany({
        where: { recallId: recall.id, userId: { in: data.map((d) => d.userId) }, pushedAt: null, score: { gte: PUSH_THRESHOLD } },
        select: { id: true },
      });
      toPush.push(...fresh.map((a) => a.id));
    }
  }

  // Category subscriptions ("all critical food recalls sold in my state"): no terms, so they
  // are matched by category + severity + distribution instead of text.
  for (const recall of recalls) {
    const subs = await prisma.$queryRaw<Array<{ id: string; userId: string; label: string; homeState: string | null; lastKnownState: string | null }>>(Prisma.sql`
      SELECT wi.id, wi."userId", wi.label, u."homeState", u."lastKnownState"
      FROM "WatchItem" wi JOIN "User" u ON u.id = wi."userId"
      WHERE wi.kind = 'category'
        AND ${recall.category}::"RecallCategory" = ANY(wi.categories)
        AND COALESCE(wi."minSeverity"::text, 'unknown') IN (${Prisma.join(severitiesAtOrBelow(recall.severity))})
    `);
    if (!subs.length) continue;
    const data = subs
      .map((sub) => {
        const states = [sub.homeState, sub.lastKnownState].filter((x): x is string => !!x);
        const local = !recall.distributionStates.length || recall.distributionStates.includes("US") || states.some((st) => recall.distributionStates.includes(st));
        // Subscriptions are about "near me": skip recalls clearly sold elsewhere when we know where the user is.
        if (states.length && !local) return null;
        const score = round(Math.min(1, (recall.severity === "critical" ? 0.7 : recall.severity === "high" ? 0.55 : 0.4) + (states.length && local ? 0.1 : 0)));
        return { userId: sub.userId, recallId: recall.id, watchItemId: sub.id, reason: "category_subscription" as const, score, explanation: `${sub.label}: ${severityLabel(recall.severity)} ${categoryLabel(recall.category)} recall${local && states.length ? ` sold in ${states.join("/")}` : ""}.` };
      })
      .filter((d): d is NonNullable<typeof d> => !!d);
    if (!data.length) continue;
    const res = await prisma.alert.createMany({ data, skipDuplicates: true });
    created += res.count;
    if (res.count) {
      const fresh = await prisma.alert.findMany({ where: { recallId: recall.id, userId: { in: data.map((d) => d.userId) }, pushedAt: null, score: { gte: PUSH_THRESHOLD } }, select: { id: true } });
      toPush.push(...fresh.map((a) => a.id));
    }
  }

  if (notify && toPush.length) {
    await enqueuePushForAlerts(toPush).catch((err) => logger.error({ err }, "failed to enqueue push jobs"));
  }
  return created;
}

export interface RecallMatch {
  recall: Recall;
  match: Match;
}

/**
 * Direction B — a watch item was just created (or a scan was submitted): find recent recalls
 * that already concern it. Used for instant feedback and to backfill alerts.
 */
export async function findRecallsForItem(item: WatchItemLite, opts: { lookbackDays?: number; limit?: number } = {}): Promise<RecallMatch[]> {
  const lookback = new Date(Date.now() - (opts.lookbackDays ?? LOOKBACK_DAYS) * 86_400_000);
  const limit = opts.limit ?? 25;
  if (item.kind === "category") return findRecallsForSubscription(item, lookback, limit);
  const terms = item.terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  if (!terms.length && !item.upc) return [];
  const gtin = item.upc ? normalizeGtin(item.upc) : null;

  const conditions: Prisma.Sql[] = [];
  if (gtin) conditions.push(Prisma.sql`${gtin} = ANY(ARRAY(SELECT lpad(u, 14, '0') FROM unnest(r.upcs) AS u))`);
  const haystack = Prisma.sql`lower(r.title || ' ' || r."productDescription" || ' ' || r.company || ' ' || array_to_string(r.brands, ' '))`;
  for (const t of terms) {
    const like = `%${escapeLike(t)}%`;
    conditions.push(Prisma.sql`${haystack} LIKE ${like}`);
    const plainTerm = normalizeForMatch(t);
    if (plainTerm.length >= 2) {
      conditions.push(Prisma.sql`regexp_replace(${haystack}, '[^a-z0-9 ]', '', 'g') LIKE ${`%${plainTerm}%`}`);
    }
    if (t.length >= 4) {
      conditions.push(Prisma.sql`word_similarity(${t}, ${haystack}) >= ${FUZZY_THRESHOLD}`);
    }
  }
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r.id FROM "Recall" r
    WHERE r."publishedAt" >= ${lookback}
      AND (${Prisma.join(conditions, " OR ")})
    ORDER BY r."publishedAt" DESC
    LIMIT ${limit * 3}
  `);
  if (!rows.length) return [];
  const recalls = await prisma.recall.findMany({ where: { id: { in: rows.map((r) => r.id) } } });

  const out: RecallMatch[] = [];
  for (const recall of recalls) {
    const text = recallText(recall);
    const plain = normalizeForMatch(text);
    const matched = terms.filter((t) => text.includes(t) || plain.includes(normalizeForMatch(t)) || fuzzyIncludes(text, t));
    const upcHit = !!gtin && recall.upcs.some((u) => normalizeGtin(u) === gtin);
    const match = scoreMatch(item, recall, matched, upcHit);
    if (match) out.push({ recall, match });
  }
  out.sort((a, b) => b.match.score - a.match.score || b.recall.publishedAt.getTime() - a.recall.publishedAt.getTime());
  return out.slice(0, limit);
}

async function findRecallsForSubscription(item: WatchItemLite & { minSeverity?: Recall["severity"] | null }, lookback: Date, limit: number): Promise<RecallMatch[]> {
  const categories = item.categories ?? [];
  if (!categories.length) return [];
  const states = [item.homeState, item.lastKnownState].filter((x): x is string => !!x);
  const recalls = await prisma.recall.findMany({
    where: {
      publishedAt: { gte: lookback },
      category: { in: categories },
      severity: { in: severitiesAtOrAbove(item.minSeverity ?? "unknown") },
      ...(states.length ? { OR: [{ distributionStates: { isEmpty: true } }, { distributionStates: { has: "US" } }, ...states.map((st) => ({ distributionStates: { has: st } }))] } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return recalls.map((recall) => ({
    recall,
    match: {
      reason: "category_subscription" as const,
      score: round(Math.min(1, (recall.severity === "critical" ? 0.7 : recall.severity === "high" ? 0.55 : 0.4) + (states.length ? 0.1 : 0))),
      explanation: `${item.label}: ${severityLabel(recall.severity)} ${categoryLabel(recall.category)} recall${states.length ? ` sold in ${states.join("/")}` : ""}.`,
      matchedTerms: [],
    },
  }));
}

const SEVERITY_ORDER: Recall["severity"][] = ["unknown", "low", "high", "critical"];
/** Severities that a subscription with the given minimum accepts. */
export function severitiesAtOrAbove(min: Recall["severity"]): Recall["severity"][] {
  return SEVERITY_ORDER.slice(SEVERITY_ORDER.indexOf(min));
}
/** Minimums that would accept a recall of the given severity. */
export function severitiesAtOrBelow(sev: Recall["severity"]): Recall["severity"][] {
  return SEVERITY_ORDER.slice(0, SEVERITY_ORDER.indexOf(sev) + 1);
}
function severityLabel(s: Recall["severity"]): string {
  return { critical: "Critical (Class I)", high: "High (Class II)", low: "Low (Class III)", unknown: "Unclassified" }[s];
}
function categoryLabel(c: Recall["category"]): string {
  return c.replace(/_/g, " ");
}

/** Lower-case and strip punctuation so "Boar's Head" and "boars head" compare equal. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Cheap in-process approximation of word_similarity for explanation purposes. */
function fuzzyIncludes(text: string, term: string): boolean {
  if (term.length < 4) return false;
  const stripped = term.replace(/[^a-z0-9]/g, "");
  return stripped.length >= 4 && text.replace(/[^a-z0-9]/g, "").includes(stripped);
}

/** Persist Direction-B matches as alerts for the item's owner (no push: the user is looking at them). */
export async function recordAlertsForItem(item: WatchItemLite, matches: RecallMatch[]): Promise<number> {
  if (!matches.length) return 0;
  const res = await prisma.alert.createMany({
    data: matches.map((m) => ({
      userId: item.userId,
      recallId: m.recall.id,
      watchItemId: item.id,
      reason: m.match.reason,
      score: m.match.score,
      explanation: m.match.explanation,
      pushedAt: new Date(), // already shown in-app; don't push later
    })),
    skipDuplicates: true,
  });
  return res.count;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
