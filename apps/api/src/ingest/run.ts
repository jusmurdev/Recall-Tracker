import type { Prisma, Recall } from "@prisma/client";
import type { RecallSource } from "@recall/shared";
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { matchRecalls } from "../matching/engine.js";
import { contentHash } from "./normalize.js";
import { buildAdapter, type Fetcher } from "./sources/index.js";
import type { FetchWindow, NormalizedRecall } from "./types.js";

export interface IngestResult {
  source: RecallSource;
  fetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  alertsCreated: number;
  changedRecallIds: string[];
}

/** Overlap re-fetched on every run so late edits at the source are picked up. */
const OVERLAP_DAYS = 3;

export function computeWindow(watermark: Date | null, now: Date, backfillDays: number): FetchWindow {
  const since = watermark
    ? new Date(watermark.getTime() - OVERLAP_DAYS * 86_400_000)
    : new Date(now.getTime() - backfillDays * 86_400_000);
  return { since, until: now };
}

/**
 * Run one ingestion cycle for a source: fetch → normalise → upsert → match → notify queue.
 * Idempotent: unchanged records (same contentHash) are skipped and never re-alert.
 */
export async function ingestSource(source: RecallSource, opts: { fetcher?: Fetcher; now?: Date } = {}): Promise<IngestResult> {
  const now = opts.now ?? new Date();
  const state = await prisma.sourceSyncState.upsert({
    where: { source },
    create: { source, lastRunAt: now },
    update: { lastRunAt: now },
  });
  const run = await prisma.ingestRun.create({ data: { source } });
  const window = computeWindow(state.watermark, now, env().INGEST_BACKFILL_DAYS);
  const log = logger.child({ source, runId: run.id, since: window.since.toISOString(), until: window.until.toISOString() });

  try {
    const adapter = buildAdapter(source, opts.fetcher);
    const items = await adapter.fetch(window);
    log.info({ fetched: items.length }, "fetched recalls");

    const { inserted, updated, unchanged, changed } = await upsertRecalls(items);
    const alertsCreated = changed.length ? await matchRecalls(changed) : 0;

    const maxPublished = items.reduce<Date | null>((acc, r) => {
      const t = r.sourceUpdatedAt ?? r.publishedAt;
      return !acc || t > acc ? t : acc;
    }, null);
    // Never advance the watermark past "now" (sources sometimes carry future-dated rows).
    const watermark = maxPublished && maxPublished < now ? maxPublished : now;

    await prisma.$transaction([
      prisma.sourceSyncState.update({
        where: { source },
        data: { watermark, lastSuccessAt: now, lastError: null, consecutiveFailures: 0 },
      }),
      prisma.ingestRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ok: true, fetched: items.length, inserted, updated, unchanged, alertsCreated },
      }),
    ]);
    log.info({ inserted, updated, unchanged, alertsCreated }, "ingest complete");
    return { source, fetched: items.length, inserted, updated, unchanged, alertsCreated, changedRecallIds: changed.map((c) => c.id) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, "ingest failed");
    await prisma.$transaction([
      prisma.sourceSyncState.update({
        where: { source },
        data: { lastError: message, consecutiveFailures: { increment: 1 } },
      }),
      prisma.ingestRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error: message } }),
    ]);
    throw err;
  }
}

export async function upsertRecalls(items: NormalizedRecall[]): Promise<{
  inserted: number;
  updated: number;
  unchanged: number;
  changed: Recall[];
}> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const changed: Recall[] = [];
  if (!items.length) return { inserted, updated, unchanged, changed };

  const existing = await prisma.recall.findMany({
    where: { OR: items.map((i) => ({ source: i.source, sourceId: i.sourceId })) },
    select: { id: true, source: true, sourceId: true, contentHash: true, severity: true, status: true },
  });
  const byKey = new Map(existing.map((e) => [`${e.source}:${e.sourceId}`, e]));

  for (const item of items) {
    const hash = contentHash(item);
    const prev = byKey.get(`${item.source}:${item.sourceId}`);
    if (prev && prev.contentHash === hash) {
      unchanged += 1;
      continue;
    }
    const data: Prisma.RecallUncheckedCreateInput = {
      source: item.source,
      sourceId: item.sourceId,
      title: item.title,
      summary: item.summary,
      productDescription: item.productDescription,
      reason: item.reason,
      category: item.category,
      severity: item.severity,
      status: item.status,
      company: item.company,
      brands: item.brands,
      upcs: item.upcs,
      distributionStates: item.distributionStates,
      recallDate: item.recallDate,
      publishedAt: item.publishedAt,
      sourceUpdatedAt: item.sourceUpdatedAt,
      url: item.url,
      imageUrls: item.imageUrls,
      contentHash: hash,
      raw: item.raw as Prisma.InputJsonValue,
    };
    const row = await prisma.recall.upsert({
      where: { source_sourceId: { source: item.source, sourceId: item.sourceId } },
      create: data,
      update: data,
    });
    if (prev) {
      updated += 1;
      // Only re-alert on updates that matter to a consumer (escalation or re-opening).
      const escalated = severityRank(row.severity) > severityRank(prev.severity);
      const reopened = prev.status !== "ongoing" && row.status === "ongoing";
      if (escalated || reopened) changed.push(row);
    } else {
      inserted += 1;
      changed.push(row);
    }
  }
  return { inserted, updated, unchanged, changed };
}

function severityRank(s: Recall["severity"]): number {
  return { unknown: 0, low: 1, high: 2, critical: 3 }[s];
}
