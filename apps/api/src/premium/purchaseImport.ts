/**
 * PREMIUM — import purchase history through a user-connected remote MCP server
 * (grocery, delivery or shopping account) and turn it into watch items.
 *
 * Claude talks to the MCP server directly via the Messages API MCP connector; our server
 * never has to understand each retailer's API. The output is constrained to a JSON schema.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import type { Connector, WatchItem } from "@prisma/client";
import { prisma } from "../db/client.js";
import { decryptSecret } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { findRecallsForItem, recordAlertsForItem } from "../matching/engine.js";
import { runStructured } from "../ai/index.js";
import { assertQuota, providerFromClient } from "./claude.js";

export const PurchasedItem = z.object({
  name: z.string().describe("Product name as the retailer lists it"),
  brand: z.string().nullable().describe("Brand or manufacturer if shown"),
  upc: z.string().nullable().describe("UPC/EAN digits only, if available"),
  category: z.enum(["food", "meat_poultry", "dietary_supplement", "cosmetic", "drug", "medical_device", "veterinary", "consumer_product", "other"]),
  lastPurchasedAt: z.string().nullable().describe("ISO date of the most recent purchase"),
  timesPurchased: z.number().int().min(1),
});
export const PurchaseImport = z.object({
  items: z.array(PurchasedItem).max(200),
  retailer: z.string(),
  notes: z.string().describe("One or two sentences on what was imported and anything that could not be read"),
});
export type PurchaseImport = z.infer<typeof PurchaseImport>;

const SYSTEM = `You help a consumer-safety app build a list of products a person buys so it can alert them about government recalls.
Use the connected retailer tools to read the person's order history from the last 6 months. Consolidate repeat purchases of the same product.
Keep food, drinks, supplements, baby products, pet food, cosmetics, medicines and kitchen products. Skip services, fees, tips and non-physical items.
Never invent products: only return items you actually saw in the order data. Return UPCs only when the retailer data includes them.`;

export interface ImportOutcome {
  created: WatchItem[];
  skippedDuplicates: number;
  summary: string;
}

export async function importPurchases(connector: Connector, userId: string, client?: Anthropic): Promise<ImportOutcome> {
  await assertQuota(userId);
  const token = connector.tokenCiphertext ? decryptSecret(connector.tokenCiphertext) : undefined;
  // Needs an MCP-capable provider (Claude or OpenAI); the registry picks one.
  const { data } = await runStructured(
    userId,
    {
      feature: "purchase_import",
      system: SYSTEM,
      prompt: `Import my ${connector.displayName} purchases from the last 6 months.`,
      schema: PurchaseImport,
      mcp: { name: connector.provider, url: connector.mcpUrl, token },
    },
    { provider: providerFromClient(client) },
  );
  return materialize(data, connector, userId);
}

/** Create watch items from an import result, skipping items the user already watches. */
export async function materialize(parsed: PurchaseImport, connector: Connector, userId: string): Promise<ImportOutcome> {
  const existing = await prisma.watchItem.findMany({ where: { userId }, select: { label: true, upc: true } });
  const labels = new Set(existing.map((e) => e.label.toLowerCase()));
  const upcs = new Set(existing.map((e) => e.upc).filter(Boolean));
  const created: WatchItem[] = [];
  let skipped = 0;

  for (const item of parsed.items) {
    const upc = item.upc?.replace(/\D/g, "") || null;
    const label = item.brand && !item.name.toLowerCase().includes(item.brand.toLowerCase()) ? `${item.brand} ${item.name}` : item.name;
    if (labels.has(label.toLowerCase()) || (upc && upcs.has(upc))) {
      skipped += 1;
      continue;
    }
    const terms = uniq([item.brand, ...significantWords(item.name)].filter((t): t is string => !!t && t.length >= 3)).slice(0, 8);
    const wi = await prisma.watchItem.create({
      data: {
        userId,
        kind: upc ? "upc" : "product",
        label: label.slice(0, 120),
        terms,
        upc: upc && upc.length >= 8 ? upc : null,
        categories: item.category === "other" ? [] : [item.category],
        context: `Imported from ${connector.displayName}${item.lastPurchasedAt ? `, last bought ${item.lastPurchasedAt}` : ""}`,
        importedFrom: connector.provider,
      },
    });
    created.push(wi);
    labels.add(label.toLowerCase());
    if (upc) upcs.add(upc);
    // Instant backfill: anything already recalled shows up in the inbox right away.
    const matches = await findRecallsForItem({ ...wi, homeState: null });
    await recordAlertsForItem({ ...wi, homeState: null }, matches);
  }
  logger.info({ userId, connector: connector.id, created: created.length, skipped }, "purchase import complete");
  return { created, skippedDuplicates: skipped, summary: parsed.notes };
}

function significantWords(name: string): string[] {
  const stop = new Set(["the", "and", "with", "pack", "count", "oz", "fl", "lb", "ct", "of", "for", "organic", "fresh"]);
  const words = name.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !stop.has(w));
  const phrase = words.slice(0, 3).join(" ");
  return phrase ? [phrase, ...words.slice(0, 4)] : words.slice(0, 4);
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}
