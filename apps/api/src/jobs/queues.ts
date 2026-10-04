import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { RecallSource } from "@recall/shared";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

export const QUEUE_INGEST = "ingest";
export const QUEUE_PUSH = "push";
export const QUEUE_RESEARCH = "research";
export const QUEUE_RECEIPTS = "push-receipts";

export interface IngestJob {
  source: RecallSource;
}
export interface PushJob {
  alertIds?: string[];
  /** RestaurantNotice ids (grade changes etc.). */
  noticeIds?: string[];
}
export interface GradeJob {
  profileId: string;
}
export interface ResearchJob {
  /** Shared RestaurantProfile to research; every watch item linked to it is updated. */
  profileId: string;
  /** User whose request triggered the research (charged against their AI quota). */
  userId: string;
}
export interface ReceiptsJob {
  ticketIds: string[];
}

let connection: Redis | null = null;
export function redis(): Redis {
  if (!connection) {
    connection = new Redis(env().REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
    connection.on("error", (err: Error) => logger.warn({ err: err.message }, "redis error"));
  }
  return connection;
}

const queues = new Map<string, Queue>();
function queue<T>(name: string): Queue<T> {
  let q = queues.get(name) as Queue<T> | undefined;
  if (!q) {
    q = new Queue<T>(name, { connection: redis() });
    queues.set(name, q as Queue);
  }
  return q;
}

export const ingestQueue = (): Queue<IngestJob> => queue<IngestJob>(QUEUE_INGEST);
export const pushQueue = (): Queue<PushJob> => queue<PushJob>(QUEUE_PUSH);
export const researchQueue = (): Queue<ResearchJob> => queue<ResearchJob>(QUEUE_RESEARCH);
export const receiptsQueue = (): Queue<ReceiptsJob> => queue<ReceiptsJob>(QUEUE_RECEIPTS);

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: 500,
  removeOnFail: 1000,
};

/** Fan pushes out in batches of 100 (Expo's max per request). */
export async function enqueuePushForAlerts(alertIds: string[], opts: { delayMs?: number } = {}): Promise<void> {
  if (process.env.DISABLE_QUEUES === "1") return;
  for (let i = 0; i < alertIds.length; i += 100) {
    await pushQueue().add("push", { alertIds: alertIds.slice(i, i + 100) }, { ...DEFAULT_OPTS, ...(opts.delayMs ? { delay: opts.delayMs } : {}) });
  }
}

export async function enqueuePushForNotices(noticeIds: string[], opts: { delayMs?: number } = {}): Promise<void> {
  if (process.env.DISABLE_QUEUES === "1" || !noticeIds.length) return;
  for (let i = 0; i < noticeIds.length; i += 100) {
    await pushQueue().add("push-notices", { noticeIds: noticeIds.slice(i, i + 100) }, { ...DEFAULT_OPTS, ...(opts.delayMs ? { delay: opts.delayMs } : {}) });
  }
}

export const QUEUE_GRADE = "grade";
export const gradeQueue = (): Queue<GradeJob> => queue<GradeJob>(QUEUE_GRADE);
/** One grade sync per profile at a time (jobId dedupes concurrent requests). Returns false when queues are off. */
export async function enqueueGradeSync(profileId: string): Promise<boolean> {
  if (process.env.DISABLE_QUEUES === "1") return false;
  await gradeQueue().add("grade", { profileId }, { ...DEFAULT_OPTS, jobId: `grade:${profileId}` });
  return true;
}

export const QUEUE_MAINTENANCE = "maintenance";
export const maintenanceQueue = (): Queue<Record<string, never>> => queue<Record<string, never>>(QUEUE_MAINTENANCE);

export const QUEUE_DIGEST = "digest";
export const digestQueue = (): Queue<Record<string, never>> => queue<Record<string, never>>(QUEUE_DIGEST);

/**
 * One job per profile at a time: the jobId dedupes concurrent requests from several users
 * adding the same restaurant, so the AI research runs once.
 */
export async function enqueueResearch(job: ResearchJob): Promise<boolean> {
  if (process.env.DISABLE_QUEUES === "1") return false;
  await researchQueue().add("research", job, { ...DEFAULT_OPTS, jobId: `research:${job.profileId}` });
  return true;
}

export async function enqueueReceipts(ticketIds: string[]): Promise<void> {
  if (process.env.DISABLE_QUEUES === "1" || !ticketIds.length) return;
  // Expo asks clients to wait ~15 minutes before checking receipts.
  await receiptsQueue().add("receipts", { ticketIds }, { ...DEFAULT_OPTS, delay: 15 * 60_000 });
}

export async function enqueueIngestNow(source: RecallSource): Promise<void> {
  await ingestQueue().add(`ingest-${source}`, { source }, { ...DEFAULT_OPTS, attempts: 1 });
}

/** Register the repeatable ingestion schedule. Idempotent; call on worker boot. */
export async function scheduleIngestion(): Promise<void> {
  const e = env();
  const crons: Record<RecallSource, string> = { FDA: e.INGEST_CRON_FDA, FSIS: e.INGEST_CRON_FSIS, CPSC: e.INGEST_CRON_CPSC };
  for (const [source, pattern] of Object.entries(crons) as Array<[RecallSource, string]>) {
    await ingestQueue().upsertJobScheduler(`ingest-${source}`, { pattern, tz: "UTC" }, { name: `ingest-${source}`, data: { source }, opts: { attempts: 1 } });
    logger.info({ source, pattern }, "ingest schedule registered");
  }
  // Hourly: send daily digests to users whose local digest hour has arrived.
  await digestQueue().upsertJobScheduler("digest-hourly", { pattern: "7 * * * *", tz: "UTC" }, { name: "digest", data: {}, opts: { attempts: 1 } });
  // Daily: refresh grades + stale research for tracked restaurants, prune worthless profiles.
  await maintenanceQueue().upsertJobScheduler("restaurant-maintenance", { pattern: e.MAINTENANCE_CRON, tz: "UTC" }, { name: "maintenance", data: {}, opts: { attempts: 1 } });
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
