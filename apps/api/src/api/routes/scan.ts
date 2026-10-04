import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ScanMatchRequest } from "@recall/shared";
import { prisma } from "../../db/client.js";
import { findRecallsForItem, recordAlertsForItem } from "../../matching/engine.js";
import { identifyProduct } from "../../premium/scanIdentify.js";
import { extractFromOcr } from "../../scan/extract.js";
import { HttpProblem, requirePremium, requireUser } from "../plugins/auth.js";
import { serializeRecall, serializeWatchItem } from "../serialize.js";

export async function scanRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Free: match OCR text / a barcode against the recall database. OCR itself runs on the
   * phone (ML Kit); only text reaches the server. Optionally saves a watch item.
   */
  app.post("/v1/scan/match", async (req) => {
    const user = requireUser(req);
    const body = ScanMatchRequest.parse(req.body);
    if (!body.ocrText && !body.upc) throw new HttpProblem(400, "validation", "Provide ocrText and/or upc.");
    const extracted = extractFromOcr(body.ocrText, body.context, body.upc);
    const terms = extracted.terms;
    const probe = { id: "probe", userId: user.id, kind: "scan" as const, label: extracted.brand ?? terms[0] ?? body.upc ?? "scan", terms, upc: extracted.upc, categories: [], homeState: user.homeState };
    const matches = await findRecallsForItem(probe, { limit: 10 });

    let watchItem = null;
    if (body.watch) {
      watchItem = await prisma.watchItem.create({
        data: {
          userId: user.id,
          kind: extracted.upc && !terms.length ? "upc" : "scan",
          label: probe.label.slice(0, 120),
          terms,
          upc: extracted.upc,
          context: body.context,
          ocrText: body.ocrText,
        },
      });
      await recordAlertsForItem({ ...watchItem, homeState: user.homeState }, matches);
    }
    return {
      extracted,
      matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
      watchItem: watchItem ? serializeWatchItem(watchItem) : null,
    };
  });

  /** Premium: send the photo itself for AI identification, then match. */
  app.post("/v1/scan/identify", { bodyLimit: 8 * 1024 * 1024 }, async (req) => {
    const user = requirePremium(req);
    const body = z
      .object({
        imageBase64: z.string().min(100),
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]).default("image/jpeg"),
        ocrText: z.string().max(4000).optional(),
        context: z.string().max(500).optional(),
      })
      .parse(req.body);
    const identified = await identifyProduct(user.id, { base64: body.imageBase64, mediaType: body.mediaType }, body.ocrText, body.context);
    const terms = [...new Set([identified.brand, identified.productName, ...identified.searchTerms].filter((t): t is string => !!t).map((t) => t.toLowerCase()))].slice(0, 8);
    const probe = { id: "probe", userId: user.id, kind: "scan" as const, label: [identified.brand, identified.productName].filter(Boolean).join(" ") || "scan", terms, upc: identified.upc, categories: [], homeState: user.homeState };
    const matches = await findRecallsForItem(probe, { limit: 10 });
    return {
      identified,
      extracted: { brand: identified.brand, terms, upc: identified.upc },
      matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
    };
  });
}
