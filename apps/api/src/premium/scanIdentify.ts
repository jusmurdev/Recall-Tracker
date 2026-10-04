/**
 * PREMIUM — identify a product from a photo when on-device OCR is weak (curved bottles,
 * glare, handwriting). Returns brand/product terms the matching engine can use.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { runStructured } from "../ai/index.js";
import { assertQuota, providerFromClient } from "./claude.js";

export const Identified = z.object({
  brand: z.string().nullable(),
  productName: z.string().nullable(),
  variant: z.string().nullable().describe("Flavor, size, or form, e.g. 'Creamy 16 oz'"),
  upc: z.string().nullable().describe("Digits only if a barcode number is legible"),
  lotOrDateCodes: z.array(z.string()).max(10),
  category: z.enum(["food", "meat_poultry", "dietary_supplement", "cosmetic", "drug", "medical_device", "veterinary", "consumer_product", "other"]),
  searchTerms: z.array(z.string()).max(8).describe("Short terms that would find this product in a recall database"),
  confidence: z.enum(["high", "medium", "low"]),
});
export type Identified = z.infer<typeof Identified>;

export async function identifyProduct(
  userId: string,
  image: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  ocrText?: string,
  context?: string,
  client?: Anthropic,
): Promise<Identified> {
  await assertQuota(userId);
  const { data } = await runStructured(
    userId,
    {
      feature: "scan_identify",
      prompt: `Identify this consumer product for a recall lookup. Read the label carefully; prefer what is printed over guesses.${ocrText ? `\n\nOn-device OCR text (may be noisy):\n${ocrText.slice(0, 3000)}` : ""}${context ? `\n\nUser note: ${context}` : ""}`,
      schema: Identified,
      images: [image],
      maxTokens: 4000,
      effort: "low",
    },
    { provider: providerFromClient(client) },
  );
  return data;
}
