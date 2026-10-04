import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateConnectorRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { encryptSecret } from "../../lib/crypto.js";
import { enqueueResearch } from "../../jobs/queues.js";
import { importPurchases } from "../../premium/purchaseImport.js";
import { PremiumUnavailableError, QuotaExceededError } from "../../premium/claude.js";
import { HttpProblem, requirePremium } from "../plugins/auth.js";
import { serializeConnector, serializeRecall, serializeWatchItem } from "../serialize.js";

/** Known MCP endpoints for providers that publish one. Users can also paste a custom URL. */
export const PROVIDER_PRESETS: Record<string, { label: string; mcpUrl: string | null; docs: string }> = {
  instacart: { label: "Instacart", mcpUrl: null, docs: "https://docs.instacart.com/developer_platform_api/" },
  doordash: { label: "DoorDash", mcpUrl: null, docs: "https://developer.doordash.com/" },
  ubereats: { label: "Uber Eats", mcpUrl: null, docs: "https://developer.uber.com/docs/eats" },
  amazon: { label: "Amazon", mcpUrl: null, docs: "https://developer.amazon.com/" },
  walmart: { label: "Walmart", mcpUrl: null, docs: "https://developer.walmart.com/" },
  kroger: { label: "Kroger", mcpUrl: null, docs: "https://developer.kroger.com/" },
  custom: { label: "Custom MCP server", mcpUrl: null, docs: "https://modelcontextprotocol.io/" },
};

export async function premiumRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/premium/providers", async () => ({
    providers: Object.entries(PROVIDER_PRESETS).map(([id, p]) => ({ id, ...p })),
  }));

  app.get("/v1/premium/connectors", async (req) => {
    const user = requirePremium(req);
    const connectors = await prisma.connector.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return { items: connectors.map(serializeConnector) };
  });

  app.post("/v1/premium/connectors", async (req, reply) => {
    const user = requirePremium(req);
    const body = CreateConnectorRequest.parse(req.body);
    if (!/^https:\/\//.test(body.mcpUrl)) throw new HttpProblem(400, "validation", "MCP server URL must use https.");
    const connector = await prisma.connector.create({
      data: {
        userId: user.id,
        provider: body.provider,
        displayName: body.displayName,
        mcpUrl: body.mcpUrl,
        tokenCiphertext: body.authorizationToken ? encryptSecret(body.authorizationToken) : null,
      },
    });
    return reply.status(201).send(serializeConnector(connector));
  });

  app.delete("/v1/premium/connectors/:id", async (req, reply) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const res = await prisma.connector.deleteMany({ where: { id, userId: user.id } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Connector not found");
    return reply.status(204).send();
  });

  /** Runs synchronously: Claude reads the account through MCP and returns products. */
  app.post("/v1/premium/connectors/:id/import", async (req) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const connector = await prisma.connector.findFirst({ where: { id, userId: user.id } });
    if (!connector) throw new HttpProblem(404, "not_found", "Connector not found");
    try {
      const outcome = await importPurchases(connector, user.id);
      await prisma.connector.update({ where: { id }, data: { lastSyncAt: new Date(), lastSyncStatus: "ok", lastSyncError: null } });
      return { connectorId: id, created: outcome.created.map(serializeWatchItem), skippedDuplicates: outcome.skippedDuplicates, summary: outcome.summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.connector.update({ where: { id }, data: { lastSyncAt: new Date(), lastSyncStatus: "error", lastSyncError: message.slice(0, 500) } });
      throw translate(err);
    }
  });

  /** Restaurant research status + manual refresh. */
  app.get("/v1/premium/restaurants/:id", async (req) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id, kind: "restaurant" } });
    if (!item) throw new HttpProblem(404, "not_found", "Restaurant not found");
    const alerts = await prisma.alert.findMany({ where: { watchItemId: id }, include: { recall: true }, orderBy: { createdAt: "desc" }, take: 20 });
    const research = (item.researchJson ?? null) as null | { suppliers?: unknown[]; riskSignals?: Array<{ signal: string; sourceUrl: string | null }>; sources?: string[] };
    return {
      watchItemId: item.id,
      restaurant: item.restaurantName ?? item.label,
      summary: item.researchSummary ?? "",
      supplierTerms: item.terms,
      riskSignals: research?.riskSignals ?? [],
      sources: research?.sources ?? [],
      matchedRecalls: alerts.map((a) => ({ recall: serializeRecall(a.recall), reason: a.reason, score: a.score, explanation: a.explanation })),
      researchedAt: item.researchUpdatedAt?.toISOString() ?? null,
      status: item.researchUpdatedAt ? "ready" : "pending",
    };
  });

  app.post("/v1/premium/restaurants/:id/refresh", async (req, reply) => {
    const user = requirePremium(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id, kind: "restaurant" } });
    if (!item) throw new HttpProblem(404, "not_found", "Restaurant not found");
    await enqueueResearch({ watchItemId: id, userId: user.id });
    return reply.status(202).send({ queued: true });
  });

  app.get("/v1/premium/usage", async (req) => {
    const user = requirePremium(req);
    const since = new Date(Date.now() - 24 * 3600_000);
    const rows = await prisma.aiUsage.groupBy({ by: ["feature"], where: { userId: user.id, createdAt: { gte: since } }, _count: true, _sum: { inputTokens: true, outputTokens: true } });
    return { last24h: rows.map((r) => ({ feature: r.feature, requests: r._count, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0 })) };
  });

  /**
   * Entitlement webhook (RevenueCat-style). The store SDK on the phone handles purchase;
   * this flips the server-side tier so premium endpoints unlock.
   */
  app.post("/v1/webhooks/revenuecat", async (req, reply) => {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) throw new HttpProblem(503, "not_configured", "Webhook secret not configured");
    if (req.headers.authorization !== `Bearer ${secret}`) throw new HttpProblem(401, "unauthorized", "Bad webhook secret");
    const body = z
      .object({
        event: z.object({
          type: z.string(),
          app_user_id: z.string(),
          expiration_at_ms: z.number().nullable().optional(),
          original_transaction_id: z.string().nullable().optional(),
        }),
      })
      .parse(req.body);
    const e = body.event;
    const active = !["CANCELLATION", "EXPIRATION", "BILLING_ISSUE"].includes(e.type) || (e.expiration_at_ms ?? 0) > Date.now();
    await prisma.user.updateMany({
      where: { OR: [{ id: e.app_user_id }, { installId: e.app_user_id }] },
      data: {
        tier: active ? "premium" : "free",
        premiumExpiresAt: e.expiration_at_ms ? new Date(e.expiration_at_ms) : null,
        subscriptionRef: e.original_transaction_id ?? undefined,
      },
    });
    return reply.send({ ok: true });
  });
}

function translate(err: unknown): Error {
  if (err instanceof PremiumUnavailableError) return new HttpProblem(503, "ai_unavailable", err.message);
  if (err instanceof QuotaExceededError) return new HttpProblem(429, "quota_exceeded", err.message);
  if (err instanceof HttpProblem) return err;
  return new HttpProblem(502, "ai_error", err instanceof Error ? err.message : "AI request failed");
}
