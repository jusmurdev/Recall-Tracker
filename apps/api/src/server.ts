import { env } from "./config/env.js";
import { buildApp } from "./api/app.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./db/client.js";
import { closeQueues } from "./jobs/queues.js";

async function main(): Promise<void> {
  const e = env();
  const app = await buildApp();
  await app.listen({ port: e.PORT, host: "0.0.0.0" });
  logger.info({ port: e.PORT }, "api listening");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await closeQueues();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "api failed to start");
  process.exit(1);
});
