/**
 * Run one ingestion pass for every source without the queue/worker.
 *   npm run ingest:once              # live APIs
 *   npm run ingest:fixtures          # recorded fixtures (offline)
 */
import { resetEnvCache } from "../config/env.js";
import { prisma } from "../db/client.js";
import { ingestSource } from "../ingest/run.js";
import { ALL_SOURCES } from "../ingest/sources/index.js";
import { logger } from "../lib/logger.js";

if (process.argv.includes("--fixtures")) {
  process.env.INGEST_USE_FIXTURES = "1";
  resetEnvCache();
}
process.env.DISABLE_QUEUES ??= "1";

const only = process.argv.find((a) => a.startsWith("--source="))?.split("=")[1]?.toUpperCase();

try {
  for (const source of ALL_SOURCES) {
    if (only && source !== only) continue;
    const r = await ingestSource(source);
    logger.info(r, "done");
  }
} finally {
  await prisma.$disconnect();
}
