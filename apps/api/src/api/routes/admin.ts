import type { FastifyInstance, FastifyRequest } from "fastify";
import { RecallSource } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { enqueueIngestNow } from "../../jobs/queues.js";
import { HttpProblem } from "../plugins/auth.js";

function requireAdmin(req: FastifyRequest): void {
  const token = process.env.ADMIN_TOKEN;
  if (!token) throw new HttpProblem(503, "not_configured", "ADMIN_TOKEN not set");
  if (req.headers["x-admin-token"] !== token) throw new HttpProblem(401, "unauthorized", "Bad admin token");
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/ingest", async (req) => {
    requireAdmin(req);
    const [states, runs] = await Promise.all([
      prisma.sourceSyncState.findMany(),
      prisma.ingestRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
    ]);
    return { states, runs };
  });

  app.post("/v1/admin/ingest/:source", async (req, reply) => {
    requireAdmin(req);
    const source = RecallSource.parse((req.params as { source: string }).source.toUpperCase());
    await enqueueIngestNow(source);
    return reply.status(202).send({ queued: source });
  });
}
