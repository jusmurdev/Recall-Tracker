import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { RecallListQuery } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { recallIdsForDiet } from "../../diet/alerts.js";
import { hasDietSelection } from "../../diet/match.js";
import { escapeLike } from "../../matching/engine.js";
import { HttpProblem, requireUser } from "../plugins/auth.js";
import { serializeRecall } from "../serialize.js";

/** Cursor = base64("<publishedAt ms>|<id>") for stable keyset pagination. */
function encodeCursor(publishedAt: Date, id: string): string {
  return Buffer.from(`${publishedAt.getTime()}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string): { publishedAt: Date; id: string } | null {
  try {
    const [ms, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!ms || !id) return null;
    return { publishedAt: new Date(Number(ms)), id };
  } catch {
    return null;
  }
}

export async function recallRoutes(app: FastifyInstance): Promise<void> {
  /** Public feed. Served to every client from the shared database — no upstream calls. */
  app.get("/v1/recalls", async (req) => {
    const q = RecallListQuery.parse(req.query);
    const where: Prisma.RecallWhereInput = {};
    if (q.source) where.source = q.source;
    if (q.category) where.category = q.category;
    if (q.severity) where.severity = q.severity;
    if (q.since) where.publishedAt = { gte: new Date(q.since) };
    if (q.state) where.OR = [{ distributionStates: { has: q.state } }, { distributionStates: { has: "US" } }, { distributionStates: { isEmpty: true } }];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      if (!c) throw new HttpProblem(400, "bad_cursor", "Invalid cursor");
      where.AND = [{ OR: [{ publishedAt: { lt: c.publishedAt } }, { publishedAt: c.publishedAt, id: { lt: c.id } }] }];
    }

    // "For my diet": only recalls matching the signed-in user's dietary profile.
    let dietHits: Awaited<ReturnType<typeof recallIdsForDiet>> | null = null;
    if (q.diet) {
      const user = requireUser(req);
      if (!hasDietSelection(user)) return { items: [], nextCursor: null, diet: { configured: false } };
      dietHits = await recallIdsForDiet(user);
      if (!dietHits.size) return { items: [], nextCursor: null, diet: { configured: true } };
      where.id = { in: [...dietHits.keys()] };
    }

    let ids: string[] | null = null;
    if (q.q) {
      // Full-text search over the generated tsvector, ranked, then filtered through Prisma.
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM "Recall"
        WHERE "searchVector" @@ websearch_to_tsquery('english', ${q.q})
           OR lower(title || ' ' || company) LIKE ${`%${escapeLike(q.q.toLowerCase())}%`}
        ORDER BY ts_rank("searchVector", websearch_to_tsquery('english', ${q.q})) DESC, "publishedAt" DESC
        LIMIT 500
      `);
      ids = rows.map((r) => r.id);
      if (dietHits) ids = ids.filter((id) => dietHits!.has(id));
      if (!ids.length) return { items: [], nextCursor: null };
      where.id = { in: ids };
    }

    const rows = await prisma.recall.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => {
        const base = serializeRecall(r);
        const hit = dietHits?.get(r.id);
        return hit ? { ...base, dietHit: { profile: hit.profile, label: hit.label, kind: hit.kind, term: hit.term, phrase: hit.phrase, field: hit.field, explanation: hit.explanation } } : base;
      }),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.publishedAt, last.id) : null,
      ...(dietHits ? { diet: { configured: true } } : {}),
    };
  });

  app.get("/v1/recalls/:id", async (req) => {
    const { id } = req.params as { id: string };
    const recall = await prisma.recall.findUnique({ where: { id } });
    if (!recall) throw new HttpProblem(404, "not_found", "Recall not found");
    return serializeRecall(recall);
  });

  /** Lightweight counters for the home screen. */
  app.get("/v1/recalls/stats", async () => {
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const [last7, bySeverity, bySource, latestRun] = await Promise.all([
      prisma.recall.count({ where: { publishedAt: { gte: since7 } } }),
      prisma.recall.groupBy({ by: ["severity"], _count: true, where: { publishedAt: { gte: since7 } } }),
      prisma.recall.groupBy({ by: ["source"], _count: true }),
      prisma.sourceSyncState.findMany({ select: { source: true, lastSuccessAt: true, lastError: true } }),
    ]);
    return {
      last7Days: last7,
      severityLast7Days: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
      totalBySource: Object.fromEntries(bySource.map((s) => [s.source, s._count])),
      sources: latestRun.map((s) => ({ source: s.source, lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null, healthy: !s.lastError })),
    };
  });
}
