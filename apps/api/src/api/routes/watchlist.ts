import type { FastifyInstance } from "fastify";
import { CreateWatchItemRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { enqueueResearch } from "../../jobs/queues.js";
import { findRecallsForItem, recordAlertsForItem } from "../../matching/engine.js";
import { attachRestaurant } from "../../premium/restaurantResearch.js";
import { HttpProblem, isPremium, requireUser } from "../plugins/auth.js";
import { serializeRecall, serializeWatchItem } from "../serialize.js";

const FREE_WATCH_LIMIT = 50;

export async function watchlistRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/watchlist", async (req) => {
    const user = requireUser(req);
    const items = await prisma.watchItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { restaurantProfile: { select: { latitude: true, longitude: true } } },
    });
    return { items: items.map(serializeWatchItem) };
  });

  app.post("/v1/watchlist", async (req, reply) => {
    const user = requireUser(req);
    const body = CreateWatchItemRequest.parse(req.body);
    const premium = isPremium(user);
    if (body.kind === "restaurant") {
      if (!premium) throw new HttpProblem(402, "premium_required", "Restaurant tracking is a Premium feature.");
      if (!body.restaurant) throw new HttpProblem(400, "validation", "restaurant details are required for kind=restaurant");
      if (body.restaurant.profileId) {
        // Fill the item's display fields from the catalog entry.
        const cat = await prisma.restaurantProfile.findUnique({ where: { id: body.restaurant.profileId } });
        if (!cat) throw new HttpProblem(404, "not_found", "That restaurant is no longer in the catalog.");
        body.restaurant = { ...body.restaurant, name: cat.name, city: body.restaurant.city ?? cat.city ?? undefined, state: body.restaurant.state ?? cat.state ?? undefined, website: body.restaurant.website ?? cat.website ?? undefined };
        if (!body.label) body.label = cat.name;
      } else if (!body.restaurant.name) {
        throw new HttpProblem(400, "validation", "restaurant.name or restaurant.profileId is required");
      }
    }
    if (body.kind === "category" && !body.categories.length) {
      throw new HttpProblem(400, "validation", "Pick at least one category to subscribe to.");
    }
    if (body.kind !== "upc" && body.kind !== "category" && !body.terms.length && !body.restaurant) {
      throw new HttpProblem(400, "validation", "At least one search term is required.");
    }
    if (!premium) {
      const count = await prisma.watchItem.count({ where: { userId: user.id } });
      if (count >= FREE_WATCH_LIMIT) throw new HttpProblem(402, "limit_reached", `Free accounts can watch up to ${FREE_WATCH_LIMIT} items.`);
    }
    const terms = [...new Set([...(body.restaurant?.name ? [body.restaurant.name.toLowerCase()] : []), ...body.terms.map((t) => t.toLowerCase())])];
    const item = await prisma.watchItem.create({
      data: {
        userId: user.id,
        kind: body.kind,
        label: body.label || body.restaurant?.name || "Restaurant",
        terms,
        upc: body.upc,
        context: body.context,
        ocrText: body.ocrText,
        categories: body.categories,
        minSeverity: body.kind === "category" ? (body.minSeverity ?? "unknown") : null,
        restaurantName: body.restaurant?.name,
        restaurantCity: body.restaurant?.city,
        restaurantState: body.restaurant?.state,
        restaurantWebsite: body.restaurant?.website,
      },
    });
    const lite = { ...item, homeState: user.homeState, lastKnownState: user.lastKnownState };
    let matches = body.kind === "restaurant" ? [] : await findRecallsForItem(lite, body.kind === "category" ? { lookbackDays: 30, limit: 15 } : {});
    let research: { status: "cached" | "queued" | "unavailable"; profileId: string; researchedAt: string | null } | null = null;
    if (body.kind === "restaurant" && body.restaurant) {
      // Research is shared: if someone already researched this restaurant recently, reuse it
      // right now and skip the AI entirely. Otherwise queue one research job for the profile.
      const attached = await attachRestaurant(item, body.restaurant);
      matches = attached.matches;
      let status: "cached" | "queued" | "unavailable" = "cached";
      if (!attached.cached) {
        const queued = attached.profile.researchStatus === "researching" || (await enqueueResearch({ profileId: attached.profile.id, userId: user.id }));
        status = queued ? "queued" : "unavailable";
      }
      research = { status, profileId: attached.profile.id, researchedAt: attached.profile.researchedAt?.toISOString() ?? null };
    } else {
      await recordAlertsForItem(lite, matches);
    }
    const fresh = body.kind === "restaurant"
      ? await prisma.watchItem.findUniqueOrThrow({ where: { id: item.id }, include: { restaurantProfile: { select: { latitude: true, longitude: true } } } })
      : item;
    return reply.status(201).send({
      item: serializeWatchItem(fresh),
      matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
      researchQueued: research?.status === "queued",
      research,
    });
  });

  app.get("/v1/watchlist/:id/matches", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const item = await prisma.watchItem.findFirst({ where: { id, userId: user.id } });
    if (!item) throw new HttpProblem(404, "not_found", "Watch item not found");
    const matches = await findRecallsForItem({ ...item, homeState: user.homeState, lastKnownState: user.lastKnownState }, { lookbackDays: 365 });
    return { matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })) };
  });

  app.delete("/v1/watchlist/:id", async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const res = await prisma.watchItem.deleteMany({ where: { id, userId: user.id } });
    if (!res.count) throw new HttpProblem(404, "not_found", "Watch item not found");
    return reply.status(204).send();
  });
}
