/**
 * PREMIUM — decode cashier shorthand with Claude. Given the OCR text (and optionally the
 * receipt photo), return a clean product name, brand and category per line. The free parser
 * runs first; this only improves what it could not expand.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { runStructured } from "../ai/index.js";
import { assertQuota, providerFromClient } from "./claude.js";

export const DecodedReceipt = z.object({
  store: z.string().nullable(),
  date: z.string().nullable().describe("ISO date if printed"),
  items: z
    .array(
      z.object({
        raw: z.string().describe("The receipt line as printed"),
        product: z.string().describe("Plain-English product name, e.g. 'Jif creamy peanut butter 16 oz'"),
        brand: z.string().nullable(),
        category: z.enum(["food", "meat_poultry", "dietary_supplement", "cosmetic", "drug", "medical_device", "veterinary", "consumer_product", "other"]),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(80),
});
export type DecodedReceipt = z.infer<typeof DecodedReceipt>;

export async function decodeReceipt(
  userId: string,
  ocrText: string,
  image?: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" },
  client?: Anthropic,
): Promise<DecodedReceipt> {
  await assertQuota(userId);
  const { data } = await runStructured(
    userId,
    {
      feature: "receipt_decode",
      prompt: `This is a store receipt. List every purchased product line with a plain-English product name and brand. Expand cashier abbreviations (PNT BTR = peanut butter, CHKN BRST = chicken breast, KRGR = Kroger store brand). Skip totals, taxes, payments, coupons and fees. Keep the original line in "raw".\n\nOCR text:\n${ocrText.slice(0, 6000)}`,
      schema: DecodedReceipt,
      images: image ? [image] : undefined,
      maxTokens: 6000,
      effort: "low",
    },
    { provider: providerFromClient(client) },
  );
  return data;
}
