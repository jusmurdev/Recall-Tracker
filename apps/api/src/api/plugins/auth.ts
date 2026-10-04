import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { User } from "@prisma/client";
import { prisma } from "../../db/client.js";
import { sha256 } from "../../lib/crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

export class HttpProblem extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Resolves `Authorization: Bearer <token>` to a user on every request (null when absent). */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest("user", null);
  app.addHook("preHandler", async (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice(7).trim();
    if (!token) return;
    const user = await prisma.user.findUnique({ where: { tokenHash: sha256(token) } });
    req.user = user;
  });
});

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpProblem(401, "unauthenticated", "Sign in first (POST /v1/auth/anonymous).");
  return req.user;
}

export function isPremium(user: User, now = new Date()): boolean {
  return user.tier === "premium" && (!user.premiumExpiresAt || user.premiumExpiresAt > now);
}

export function requirePremium(req: FastifyRequest): User {
  const user = requireUser(req);
  if (!isPremium(user)) throw new HttpProblem(402, "premium_required", "This feature requires a Premium subscription.");
  return user;
}

export function sendProblem(reply: FastifyReply, err: HttpProblem): FastifyReply {
  return reply.status(err.status).send({ error: err.code, message: err.message, code: err.code });
}
