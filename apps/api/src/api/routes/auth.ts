import type { FastifyInstance } from "fastify";
import { AnonymousAuthRequest, RegisterDeviceRequest, UpdateLocationRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { requireUser, isPremium } from "../plugins/auth.js";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Anonymous sign-in keyed by a per-install id. Returns a bearer token the app stores in
   * the secure keychain. Re-posting the same installId rotates the token (lost-device safe).
   */
  app.post("/v1/auth/anonymous", async (req, reply) => {
    const body = AnonymousAuthRequest.parse(req.body);
    const token = randomToken();
    const tokenHash = sha256(token);
    const user = await prisma.user.upsert({
      where: { installId: body.installId },
      create: { installId: body.installId, tokenHash },
      update: { tokenHash },
    });
    return reply.send({ token, user: { id: user.id, tier: isPremium(user) ? "premium" : "free", createdAt: user.createdAt.toISOString() } });
  });

  app.get("/v1/me", async (req) => {
    const user = requireUser(req);
    const premium = isPremium(user);
    return {
      id: user.id,
      tier: premium ? "premium" : "free",
      homeState: user.homeState,
      lastKnownState: user.lastKnownState,
      premium: {
        tier: premium ? "premium" : "free",
        features: { connectors: premium, restaurants: premium, aiScan: premium },
        expiresAt: user.premiumExpiresAt?.toISOString() ?? null,
      },
      createdAt: user.createdAt.toISOString(),
    };
  });

  /**
   * Coarse location from the phone. The app reverse-geocodes on-device and sends only the
   * two-letter state; we never receive coordinates. Used to rank alerts and filter the feed.
   */
  app.put("/v1/me/location", async (req) => {
    const user = requireUser(req);
    const body = UpdateLocationRequest.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastKnownState: body.state, lastLocationAt: new Date(), ...(body.setHome || !user.homeState ? { homeState: body.state } : {}) },
    });
    return { homeState: updated.homeState, lastKnownState: updated.lastKnownState, lastLocationAt: updated.lastLocationAt?.toISOString() ?? null };
  });

  app.post("/v1/devices", async (req, reply) => {
    const user = requireUser(req);
    const body = RegisterDeviceRequest.parse(req.body);
    const device = await prisma.device.upsert({
      where: { expoPushToken: body.expoPushToken },
      create: { userId: user.id, expoPushToken: body.expoPushToken, platform: body.platform },
      update: { userId: user.id, platform: body.platform, enabled: true, invalidatedAt: null, lastSeenAt: new Date() },
    });
    if (body.homeState) await prisma.user.update({ where: { id: user.id }, data: { homeState: body.homeState } });
    return reply.status(201).send({ id: device.id, enabled: device.enabled });
  });

  app.delete("/v1/devices/:token", async (req, reply) => {
    const user = requireUser(req);
    const { token } = req.params as { token: string };
    await prisma.device.updateMany({ where: { userId: user.id, expoPushToken: token }, data: { enabled: false } });
    return reply.status(204).send();
  });
}
