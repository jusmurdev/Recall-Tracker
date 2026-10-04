import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db/client.js";
import { HttpProblem, requireUser } from "../plugins/auth.js";
import { serializeAlert } from "../serialize.js";

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/alerts", async (req) => {
    const user = requireUser(req);
    const q = z.object({ unreadOnly: z.coerce.boolean().default(false), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    const alerts = await prisma.alert.findMany({
      where: { userId: user.id, ...(q.unreadOnly ? { readAt: null } : {}) },
      include: { recall: true, watchItem: { select: { label: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: q.limit,
    });
    const unread = await prisma.alert.count({ where: { userId: user.id, readAt: null } });
    return { items: alerts.map(serializeAlert), unread };
  });

  app.get("/v1/alerts/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const alert = await prisma.alert.findFirst({ where: { id, userId: user.id }, include: { recall: true, watchItem: { select: { label: true } } } });
    if (!alert) throw new HttpProblem(404, "not_found", "Alert not found");
    return serializeAlert(alert);
  });

  app.post("/v1/alerts/:id/read", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const res = await prisma.alert.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  });

  app.post("/v1/alerts/read-all", async (req) => {
    const user = requireUser(req);
    const res = await prisma.alert.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  });
}
