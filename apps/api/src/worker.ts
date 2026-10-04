/**
 * Background worker: runs scheduled ingestion, push delivery, receipt checks and premium
 * restaurant research. Scale horizontally; BullMQ guarantees each job runs once.
 */
import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { ingestSource } from "./ingest/run.js";
import { closeQueues, QUEUE_INGEST, QUEUE_PUSH, QUEUE_RECEIPTS, QUEUE_RESEARCH, redis, scheduleIngestion, type IngestJob, type PushJob, type ReceiptsJob, type ResearchJob } from "./jobs/queues.js";
import { logger } from "./lib/logger.js";
import { checkReceipts, sendPushForAlerts } from "./notifications/push.js";
import { researchRestaurant } from "./premium/restaurantResearch.js";

async function main(): Promise<void> {
  env();
  await scheduleIngestion();
  const connection = redis();

  const workers = [
    new Worker<IngestJob>(QUEUE_INGEST, async (job) => ingestSource(job.data.source), { connection, concurrency: 1 }),
    new Worker<PushJob>(QUEUE_PUSH, async (job) => sendPushForAlerts(job.data.alertIds), { connection, concurrency: 4 }),
    new Worker<ReceiptsJob>(QUEUE_RECEIPTS, async (job) => checkReceipts(job.data.ticketIds), { connection, concurrency: 2 }),
    new Worker<ResearchJob>(
      QUEUE_RESEARCH,
      async (job) => {
        const item = await prisma.watchItem.findUnique({ where: { id: job.data.watchItemId } });
        if (!item || item.kind !== "restaurant") return;
        const user = await prisma.user.findUnique({ where: { id: item.userId } });
        if (!user || user.tier !== "premium") return;
        await researchRestaurant(item);
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
