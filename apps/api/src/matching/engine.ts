import { Prisma, type Recall, type WatchItem } from "@prisma/client";
import type { MatchReason } from "@recall/shared";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { enqueuePushForAlerts } from "../jobs/queues.js";

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
    const lowerCompany = recall.company.toLowerCase();
    const lowerBrands = recall.brands.map((b) => b.toLowerCase());
    // Brand names lead product descriptions ("Jif Creamy Peanut Butter…"), so the first few
    // words of the description count as brand territory alongside company + extracted brands.
    const lead = recall.productDescription.toLowerCase().slice(0, 40);
    const companyHit = matchedTerms.some((t) => lowerCompany.includes(t) || lowerBrands.some((b) => b.includes(t) || t.includes(b)));
    const leadHit = !companyHit && matchedTerms.some((t) => lead.includes(t));
    const brandHit = companyHit || leadHit;
    const coverage = Math.min(1, matchedTerms.length / Math.max(1, item.terms.length));
    if (item.kind === "restaurant") {
      reason = "restaurant_supplier";
      score = 0.55 + 0.3 * coverage;
      explanation = `${item.label}: a supplier or ingredient we found (${matchedTerms.join(", ")}) appears in this recall.`;
    } else if (item.kind === "scan") {
      reason = "scan_text_match";
      score = (brandHit ? 0.7 : 0.5) + 0.3 * coverage;
      explanation = `Label text you scanned (${matchedTerms.join(", ")}) matches this recall.`;
    } else if (brandHit) {
      reason = "brand_match";
      // A hit on the recalling company / extracted brand list outranks the weaker
      // "appears at the start of the product description" heuristic, so ties resolve deterministically.
      score = (companyHit ? 0.75 : 0.7) + 0.25 * coverage;
      explanation = `Brand/company match on ${matchedTerms.join(", ")}.`;
    } else {
      reason = "text_match";
      score = 0.45 + 0.4 * coverage;
      explanation = `Product description mentions ${matchedTerms.join(", ")}.`;
    }
  } else {
    return null;
  }

  // Down-rank recalls not distributed in the user's state (never suppress: labels lie, people travel).
  if (item.homeState && recall.distributionStates.length && !recall.distributionStates.includes("US") && !recall.distributionStates.includes(item.homeState)) {
    score *= 0.6;
    explanation += ` Not reported as distributed in ${item.homeState}.`;
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
    // A term matches when it appears verbatim, appears after stripping punctuation
    // ("boars head" vs "Boar's Head"), or is trigram-similar to a substring of the text.
    const termMatches = Prisma.sql`
          ${text} LIKE '%' || replace(replace(replace(lower(t), '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
             OR ${plain} LIKE '%' || regexp_replace(lower(t), '[^a-z0-9 ]', '', 'g') || '%'
             OR (length(t) >= 4 AND word_similarity(lower(t), ${text}) >= ${FUZZY_THRESHOLD})`;
    const rows = await prisma.$queryRaw<CandidateRow[]>(Prisma.sql`
      SELECT wi.id, wi."userId", wi.kind, wi.label, wi.terms, wi.upc, wi.categories, u."homeState",
        ARRAY(
          SELECT t FROM unnest(wi.terms) AS t
          WHERE length(regexp_replace(lower(t), '[^a-z0-9 ]', '', 'g')) >= 2 AND (${termMatches})
        )::text[] AS matched_terms,
        (wi.upc IS NOT NULL AND wi.upc = ANY(${recall.upcs}::text[])) AS upc_hit
      FROM "WatchItem" wi
      JOIN "User" u ON u.id = wi."userId"
      WHERE (wi.upc IS NOT NULL AND wi.upc = ANY(${recall.upcs}::text[]))
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
  const terms = item.terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
  if (!terms.length && !item.upc) return [];

  const conditions: Prisma.Sql[] = [];
  if (item.upc) conditions.push(Prisma.sql`${item.upc} = ANY(r.upcs)`);
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
    const upcHit = !!item.upc && recall.upcs.includes(item.upc);
    const match = scoreMatch(item, recall, matched, upcHit);
    if (match) out.push({ recall, match });
  }
  out.sort((a, b) => b.match.score - a.match.score || b.recall.publishedAt.getTime() - a.recall.publishedAt.getTime());
  return out.slice(0, limit);
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
