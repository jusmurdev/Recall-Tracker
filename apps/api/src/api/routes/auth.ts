import type { FastifyInstance } from "fastify";
import { AnonymousAuthRequest, RegisterDeviceRequest, UpdateLocationRequest, UpdatePreferencesRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { HttpProblem, requireUser, isPremium } from "../plugins/auth.js";
import type { User } from "@prisma/client";

function prefsOf(u: User) {
  return {
    pushMinSeverity: u.pushMinSeverity,
    mutedCategories: u.mutedCategories,
    quietHoursStart: u.quietHoursStart,
    quietHoursEnd: u.quietHoursEnd,
    timezone: u.timezone,
    digestMode: u.digestMode,
    digestHour: u.digestHour,
  };
}

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
      preferences: prefsOf(user),
      premium: {
        tier: premium ? "premium" : "free",
        features: { connectors: premium, restaurants: premium, aiScan: premium },
        expiresAt: user.premiumExpiresAt?.toISOString() ?? null,
      },
      createdAt: user.createdAt.toISOString(),
    };
  });

  /** Notification preferences (partial update). */
  app.patch("/v1/me/preferences", async (req) => {
    const user = requireUser(req);
    const body = UpdatePreferencesRequest.parse(req.body);
    if ((body.quietHoursStart == null) !== (body.quietHoursEnd == null) && (body.quietHoursStart !== undefined || body.quietHoursEnd !== undefined)) {
      // Allow clearing both with nulls, or setting both; reject half-set windows.
      const merged = { s: body.quietHoursStart === undefined ? user.quietHoursStart : body.quietHoursStart, e: body.quietHoursEnd === undefined ? user.quietHoursEnd : body.quietHoursEnd };
      if ((merged.s == null) !== (merged.e == null)) throw new HttpProblem(400, "validation", "Set both quietHoursStart and quietHoursEnd, or neither.");
    }
    const updated = await prisma.user.update({ where: { id: user.id }, data: body });
    return prefsOf(updated);
  });

  /**
   * Delete the account and everything attached to it (watchlist, alerts, devices, connectors,
   * AI usage). Required for App Store review; irreversible. The install id is released so the
   * same phone can start over.
   */
  app.delete("/v1/me", async (req, reply) => {
    const user = requireUser(req);
    await prisma.user.delete({ where: { id: user.id } });
    return reply.status(204).send();
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
