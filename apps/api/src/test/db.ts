import { prisma } from "../db/client.js";

/** Wipe every table between integration tests (order matters for FKs; cascades handle the rest). */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Alert", "AiUsage", "Connector", "Device", "WatchItem", "RestaurantNotice", "RestaurantInspection", "RestaurantProfile", "User", "IngestRun", "SourceSyncState", "Recall" RESTART IDENTITY CASCADE',
  );
}
