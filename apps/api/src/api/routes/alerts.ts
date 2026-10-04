import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { DismissAlertRequest, ResolveAlertRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { HttpProblem, requireUser } from "../plugins/auth.js";
import { serializeAlert } from "../serialize.js";

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/alerts", async (req) => {
    const user = requireUser(req);
    const q = z
      .object({
        unreadOnly: z.coerce.boolean().default(false),
        includeDismissed: z.coerce.boolean().default(false),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const alerts = await prisma.alert.findMany({
      where: { userId: user.id, ...(q.unreadOnly ? { readAt: null } : {}), ...(q.includeDismissed ? {} : { dismissedAt: null }) },
      include: { recall: true, watchItem: { select: { label: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: q.limit,
    });
    const unread = await prisma.alert.count({ where: { userId: user.id, readAt: null, dismissedAt: null } });
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

  /** "I don't have this" / "wrong match": hides the alert and (for wrong matches) tells us. */
  app.post("/v1/alerts/:id/dismiss", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = DismissAlertRequest.parse(req.body ?? {});
    const res = await prisma.alert.updateMany({ where: { id, userId: user.id }, data: { dismissedAt: new Date(), dismissReason: body.reason, readAt: new Date() } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Alert not found");
    return { dismissed: true };
  });

  app.post("/v1/alerts/:id/undismiss", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const res = await prisma.alert.updateMany({ where: { id, userId: user.id }, data: { dismissedAt: null, dismissReason: null } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Alert not found");
    return { dismissed: false };
  });

  /** "Handled": the user discarded / returned / contacted the firm / checked codes and is not affected. */
  app.post("/v1/alerts/:id/resolve", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = ResolveAlertRequest.parse(req.body);
    const res = await prisma.alert.updateMany({ where: { id, userId: user.id }, data: { resolvedAt: new Date(), resolvedAction: body.action, readAt: new Date() } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Alert not found");
    return { resolved: true };
  });

  app.post("/v1/alerts/read-all", async (req) => {
    const user = requireUser(req);
    const res = await prisma.alert.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  });

  /** Counts for the badge and the settings screen. */
  app.get("/v1/alerts/summary", async (req) => {
    const user = requireUser(req);
    const [unread, open, resolved, dismissed] = await Promise.all([
      prisma.alert.count({ where: { userId: user.id, readAt: null, dismissedAt: null } }),
      prisma.alert.count({ where: { userId: user.id, dismissedAt: null, resolvedAt: null } }),
      prisma.alert.count({ where: { userId: user.id, resolvedAt: { not: null } } }),
      prisma.alert.count({ where: { userId: user.id, dismissedAt: { not: null } } }),
    ]);
    return { unread, open, resolved, dismissed };
  });
}
