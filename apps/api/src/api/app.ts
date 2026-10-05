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
import { restaurantRoutes } from "./routes/restaurants.js";
import { scanRoutes } from "./routes/scan.js";
import { watchlistRoutes } from "./routes/watchlist.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger === false ? false : { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  // @fastify/cors allows only GET/HEAD/POST by default; the app also PATCHes preferences, PUTs
  // location and DELETEs watch items, which browsers (the web build) preflight.
  await app.register(cors, { origin: true, methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] });
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
    // Fastify's own errors (bad JSON, wrong content type, too big, rate limited…) get the same
    // { error, code, message } shape as ours so clients can branch on `code` everywhere.
    const status = typeof (err as { statusCode?: number }).statusCode === "number" ? (err as { statusCode: number }).statusCode : 500;
    if (status >= 500) logger.error({ err }, "unhandled error");
    const fastifyCode = (err as { code?: string }).code ?? "";
    const code =
      status >= 500 ? "internal"
      : fastifyCode === "FST_ERR_CTP_INVALID_JSON_BODY" || fastifyCode === "FST_ERR_CTP_EMPTY_JSON_BODY" ? "bad_json"
      : fastifyCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || status === 415 ? "unsupported_media_type"
      : fastifyCode === "FST_ERR_CTP_BODY_TOO_LARGE" || status === 413 ? "payload_too_large"
      : status === 429 ? "rate_limited"
      : status === 404 ? "not_found"
      : status === 401 ? "unauthenticated"
      : status === 400 ? "validation"
      : "request_error";
    const message = status >= 500 ? "Internal error" : code === "bad_json" ? "The request body is not valid JSON." : code === "unsupported_media_type" ? "Send JSON (Content-Type: application/json)." : (err as Error).message;
    return reply.status(status).send({ error: code, code, message });
  });
  app.setNotFoundHandler((req, reply) => reply.status(404).send({ error: "not_found", code: "not_found", message: `No route for ${req.method} ${req.url}` }));

  app.get("/health", async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(authRoutes);
  await app.register(recallRoutes);
  await app.register(watchlistRoutes);
  await app.register(alertRoutes);
  await app.register(scanRoutes);
  await app.register(premiumRoutes);
  await app.register(restaurantRoutes);
  await app.register(adminRoutes);

  return app;
}
