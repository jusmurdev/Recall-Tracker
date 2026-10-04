/**
 * Background worker: runs scheduled ingestion, push delivery, receipt checks and premium
 * restaurant research. Scale horizontally; BullMQ guarantees each job runs once.
 */
import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { ingestSource } from "./ingest/run.js";
import { closeQueues, QUEUE_DIGEST, QUEUE_GRADE, QUEUE_INGEST, QUEUE_MAINTENANCE, QUEUE_PUSH, QUEUE_RECEIPTS, QUEUE_RESEARCH, redis, scheduleIngestion, type GradeJob, type IngestJob, type PushJob, type ReceiptsJob, type ResearchJob } from "./jobs/queues.js";
import { logger } from "./lib/logger.js";
import { sendDigests } from "./notifications/digest.js";
import { checkReceipts, sendPushForAlerts, sendPushForNotices } from "./notifications/push.js";
import { runMaintenance } from "./inspections/maintenance.js";
import { syncGrade } from "./inspections/sync.js";
import { researchProfile } from "./premium/restaurantResearch.js";

async function main(): Promise<void> {
  env();
  await scheduleIngestion();
  const connection = redis();

  const workers = [
    new Worker<IngestJob>(QUEUE_INGEST, async (job) => ingestSource(job.data.source), { connection, concurrency: 1 }),
    new Worker<PushJob>(
      QUEUE_PUSH,
      async (job) => {
        if (job.data.alertIds?.length) await sendPushForAlerts(job.data.alertIds);
        if (job.data.noticeIds?.length) await sendPushForNotices(job.data.noticeIds);
      },
      { connection, concurrency: 4 },
    ),
    new Worker<GradeJob>(QUEUE_GRADE, async (job) => syncGrade(job.data.profileId), { connection, concurrency: 2 }),
    new Worker(QUEUE_MAINTENANCE, async () => runMaintenance(), { connection, concurrency: 1 }),
    new Worker<ReceiptsJob>(QUEUE_RECEIPTS, async (job) => checkReceipts(job.data.ticketIds), { connection, concurrency: 2 }),
    new Worker(QUEUE_DIGEST, async () => sendDigests(), { connection, concurrency: 1 }),
    new Worker<ResearchJob>(
      QUEUE_RESEARCH,
      async (job) => {
        // Shared profile: one research run serves every user tracking this restaurant.
        const profile = await prisma.restaurantProfile.findUnique({ where: { id: job.data.profileId }, include: { _count: { select: { watchItems: true } } } });
        if (!profile || profile._count.watchItems === 0) return;
        const user = await prisma.user.findUnique({ where: { id: job.data.userId } });
        if (!user || user.tier !== "premium") return;
        await researchProfile(profile.id, user.id);
      },
      { connection, concurrency: 2 },
    ),
  ];
  for (const w of workers) {
    w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));
    w.on("completed", (job) => logger.debug({ queue: w.name, jobId: job.id }, "job completed"));
  }
  logger.info("worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "worker failed to start");
  process.exit(1);
});
