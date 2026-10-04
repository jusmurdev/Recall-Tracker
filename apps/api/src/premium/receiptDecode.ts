/**
 * PREMIUM — decode cashier shorthand with Claude. Given the OCR text (and optionally the
 * receipt photo), return a clean product name, brand and category per line. The free parser
 * runs first; this only improves what it could not expand.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import { assertQuota, claude, model, parseJsonOutput, recordUsage, textOf } from "./claude.js";

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
  client: Anthropic = claude(),
): Promise<DecodedReceipt> {
  await assertQuota(userId);
  const content: Anthropic.ContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } });
  content.push({
    type: "text",
    text: `This is a store receipt. List every purchased product line with a plain-English product name and brand. Expand cashier abbreviations (PNT BTR = peanut butter, CHKN BRST = chicken breast, KRGR = Kroger store brand). Skip totals, taxes, payments, coupons and fees. Keep the original line in "raw".\n\nOCR text:\n${ocrText.slice(0, 6000)}`,
  });
  const response = await client.messages.create({
    model: model(),
    max_tokens: 6000,
    output_config: { format: zodOutputFormat(DecodedReceipt), effort: "low" },
    messages: [{ role: "user", content }],
  });
  await recordUsage(userId, "receipt_decode", response.usage);
  if (response.stop_reason === "refusal") throw new Error("The AI declined to read this receipt.");
  return parseJsonOutput(textOf(response.content), (v) => DecodedReceipt.parse(v));
}
