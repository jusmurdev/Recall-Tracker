import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { logger } from "../lib/logger.js";
import { authPlugin, HttpProblem } from "./plugins/auth.js";
import { adminRoutes } from "./routes/admin.js";
import { alertRoutes } from "./routes/alerts.js";
import { authRoutes } from "./routes/auth.js";
import { premiumRoutes } from "./routes/premium.js";
import { recallRoutes } from "./routes/recalls.js";
import { scanRoutes } from "./routes/scan.js";
import { watchlistRoutes } from "./routes/watchlist.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cors, { origin: true });
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
  await app.register(authPlugin);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpProblem) return reply.status(err.status).send({ error: err.code, code: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "validation", code: "validation", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return reply.status(409).send({ error: "conflict", code: "conflict", message: "Already exists" });
    }
    const status = typeof (err as { statusCode?: number }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
    if (status >= 500) logger.error({ err }, "unhandled error");
    return reply.status(status).send({ error: status >= 500 ? "internal" : "request_error", message: status >= 500 ? "Internal error" : (err as Error).message });
  });

  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(recallRoutes);
  await app.register(watchlistRoutes);
  await app.register(alertRoutes);
  await app.register(scanRoutes);
  await app.register(premiumRoutes);
  await app.register(adminRoutes);

  return app;
}
