/**
 * PREMIUM — research a restaurant's supply chain and food-safety signals, then watch for
 * recalls affecting the suppliers/ingredients found.
 *
 * Uses Claude with the server-side web search tool (runs on Anthropic's infrastructure, so
 * we do no crawling ourselves). Results are stored on the watch item: the supplier terms
 * become match terms so the normal matching engine alerts the user when a supplier is recalled.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { WatchItem } from "@prisma/client";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { findRecallsForItem, recordAlertsForItem, type RecallMatch } from "../matching/engine.js";
import { assertQuota, claude, model, parseJsonOutput, recordUsage, textOf } from "./claude.js";

export const Research = z.object({
  summary: z.string().describe("3-5 sentences a diner would want to know, plain language"),
  suppliers: z
    .array(z.object({ name: z.string(), kind: z.enum(["distributor", "producer", "brand", "ingredient"]), confidence: z.enum(["confirmed", "likely", "guess"]), sourceUrl: z.string().nullable() }))
    .max(30),
  riskSignals: z.array(z.object({ signal: z.string(), sourceUrl: z.string().nullable() })).max(20),
  sources: z.array(z.string()).max(30),
});
export type Research = z.infer<typeof Research>;

const SYSTEM = `You research restaurants for a consumer food-safety app. Given a restaurant, find:
1. Who supplies its food: named distributors (e.g. Sysco, US Foods, Gordon Food Service), producers, brands it advertises using, and signature ingredients. Menus, "about us" pages, press, supplier case studies, and job postings often name them. Mark each as confirmed (named by the restaurant or supplier), likely (strong indirect evidence) or guess.
2. Food-safety signals: health inspection results, closures, reported illnesses, and recurring review complaints about food safety (not taste or service).
Be factual and cite the pages you relied on. If you cannot find something, say so rather than guessing. Do not include personal data about individuals.`;

export interface ResearchOutcome {
  research: Research;
  supplierTerms: string[];
  matches: RecallMatch[];
}

export async function researchRestaurant(item: WatchItem, client: Anthropic = claude()): Promise<ResearchOutcome> {
  await assertQuota(item.userId);
  const where = [item.restaurantCity, item.restaurantState].filter(Boolean).join(", ");
  const prompt = `Restaurant: ${item.restaurantName ?? item.label}${where ? ` (${where})` : ""}${item.restaurantWebsite ? `\nWebsite: ${item.restaurantWebsite}` : ""}${item.context ? `\nUser note: ${item.context}` : ""}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  let response = await client.messages.create({
    model: model(),
    max_tokens: 16000,
    system: SYSTEM,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location: { type: "approximate", country: "US", ...(item.restaurantCity ? { city: item.restaurantCity } : {}), ...(item.restaurantState ? { region: item.restaurantState } : {}) } }],
    output_config: { format: zodOutputFormat(Research) },
    messages,
  });
  await recordUsage(item.userId, "restaurant_research", response.usage);

  // Long server-tool turns can pause; resume by echoing the assistant turn back.
  let resumes = 0;
  while (response.stop_reason === "pause_turn" && resumes < 3) {
    resumes += 1;
    messages.push({ role: "assistant", content: response.content });
    response = await client.messages.create({
      model: model(),
      max_tokens: 16000,
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }],
      output_config: { format: zodOutputFormat(Research) },
      messages,
    });
    await recordUsage(item.userId, "restaurant_research", response.usage);
  }
  if (response.stop_reason === "refusal") throw new Error("The AI declined to research this restaurant.");

  const research = parseJsonOutput(textOf(response.content), (v) => Research.parse(v));
  return applyResearch(item, research);
}

/** Persist research onto the watch item and run matching against stored recalls. */
export async function applyResearch(item: WatchItem, research: Research): Promise<ResearchOutcome> {
  const supplierTerms = uniq(
    research.suppliers
      .filter((s) => s.confidence !== "guess")
      .map((s) => s.name.trim().toLowerCase())
      .filter((n) => n.length >= 3 && !GENERIC.has(n)),
  ).slice(0, 25);
  const terms = uniq([...item.terms.filter((t) => t.length >= 3), ...supplierTerms]);
  const updated = await prisma.watchItem.update({
    where: { id: item.id },
    data: {
      terms,
      researchSummary: research.summary,
      researchUpdatedAt: new Date(),
      researchJson: research,
    },
  });
  const lite = { ...updated, homeState: null, terms: supplierTerms.length ? supplierTerms : updated.terms };
  const matches = await findRecallsForItem(lite);
  await recordAlertsForItem(lite, matches);
  logger.info({ watchItemId: item.id, suppliers: supplierTerms.length, matches: matches.length }, "restaurant research applied");
  return { research, supplierTerms, matches };
}

/** Words that are true of every restaurant and would match everything. */
const GENERIC = new Set(["chicken", "beef", "pork", "fish", "rice", "bread", "cheese", "salt", "pepper", "oil", "flour", "sugar", "eggs", "egg", "milk", "butter", "water", "ice", "onion", "onions", "garlic", "tomato", "tomatoes", "lettuce", "produce", "meat", "seafood", "vegetables", "fruit"]);

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
