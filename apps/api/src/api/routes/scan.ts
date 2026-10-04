import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ReceiptScanRequest, type ReceiptItem } from "@recall/shared";
import { ScanMatchRequest } from "@recall/shared";
import type { Prisma } from "@prisma/client";
import { decodeReceipt } from "../../premium/receiptDecode.js";
import { PremiumUnavailableError, QuotaExceededError } from "../../premium/claude.js";
import { parseReceipt, termsFor, type ReceiptLine } from "../../scan/receipt.js";
import { isPremium } from "../plugins/auth.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../db/client.js";
import { recordAlertsForItem } from "../../matching/engine.js";
import { identifyProduct } from "../../premium/scanIdentify.js";
import { checkProduct } from "../../scan/check.js";
import { refineAmbiguousHits } from "../../diet/aiClassify.js";
import { dietHitsForLabel, hasDietSelection } from "../../diet/match.js";
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
    const label = extracted.brand ?? terms[0] ?? body.upc ?? "scan";
    const check = await checkProduct(user, { label, terms, upc: extracted.upc });
    const { matches } = check;
    // "Heads up for your diet": label words that matter to this user, whether or not anything is recalled.
    let diet = hasDietSelection(user) ? dietHitsForLabel([body.ocrText ?? "", body.context ?? ""].join("\n"), user) : [];
    if (diet.some((h) => h.kind === "ambiguous") && isPremium(user) && body.ocrText) diet = await refineAmbiguousHits(user.id, body.ocrText, diet);

    let watchItem = null;
    if (body.watch) {
      watchItem = await prisma.watchItem.create({
        data: {
          userId: user.id,
          kind: extracted.upc && !terms.length ? "upc" : "scan",
          label: label.slice(0, 120),
          terms,
          upc: extracted.upc,
          context: body.context,
          ocrText: body.ocrText,
        },
      });
      await recordAlertsForItem({ ...watchItem, homeState: user.homeState, lastKnownState: user.lastKnownState }, matches);
    }
    return {
      extracted,
      status: check.status,
      matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
      diet,
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
    const check = await checkProduct(user, { label: [identified.brand, identified.productName].filter(Boolean).join(" ") || "scan", terms, upc: identified.upc });
    const { matches } = check;
    const diet = hasDietSelection(user) ? dietHitsForLabel([body.ocrText ?? "", identified.productName ?? "", body.context ?? ""].join("\n"), user) : [];
    return {
      identified,
      extracted: { brand: identified.brand, terms, upc: identified.upc },
      status: check.status,
      diet,
      matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })),
    };
  });

  /**
   * Receipt: OCR text (free) and optionally the photo (premium, AI-decoded). Every line
   * becomes a product, every product is checked against recent recalls, and the whole
   * receipt can be watched in one tap.
   */
  app.post("/v1/scan/receipt", { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const user = requireUser(req);
    const body = ReceiptScanRequest.parse(req.body);
    if (!body.ocrText && !body.imageBase64) throw new HttpProblem(400, "validation", "Provide ocrText (and optionally imageBase64).");
    const premium = isPremium(user);
    if (body.imageBase64 && !premium) throw new HttpProblem(402, "premium_required", "Reading the receipt photo with AI is a Premium feature; text works on the free plan.");

    const parsed = parseReceipt(body.ocrText ?? "");
    let lines: ReceiptLine[] = parsed.items;
    let store = parsed.store;
    let date = parsed.date;
    let decodedByAi = false;

    // Premium: let Claude decode what the dictionary could not (or read the photo directly).
    const needsHelp = body.imageBase64 || lines.some((l) => l.terms.every((t) => t.length <= 4)) || (!!body.ocrText && lines.length === 0);
    if (premium && needsHelp) {
      try {
        const decoded = await decodeReceipt(user.id, body.ocrText ?? "", body.imageBase64 ? { base64: body.imageBase64, mediaType: body.mediaType } : undefined);
        decodedByAi = true;
        store = store ?? decoded.store;
        date = date ?? decoded.date;
        const byRaw = new Map(lines.map((l) => [l.raw.toLowerCase(), l]));
        lines = decoded.items.map((d) => {
          const prev = byRaw.get(d.raw.toLowerCase());
          const brand = d.brand?.toLowerCase() ?? prev?.brand ?? null;
          const product = d.product.toLowerCase();
          return { raw: d.raw, product, brand, terms: [...new Set([...termsFor(product, brand), ...(prev?.terms ?? [])])].slice(0, 6), price: prev?.price ?? null, quantity: prev?.quantity ?? 1 };
        });
      } catch (err) {
        if (err instanceof PremiumUnavailableError || err instanceof QuotaExceededError) logger.warn({ err: err.message }, "receipt AI decode unavailable; using parser output");
        else throw err;
      }
    }

    const existing = body.watch ? await prisma.watchItem.findMany({ where: { userId: user.id }, select: { id: true, label: true } }) : [];
    const labels = new Map(existing.map((e) => [e.label.toLowerCase(), e.id]));
    const items: ReceiptItem[] = [];
    let flagged = 0;
    for (const line of lines) {
      const { matches, status } = await checkProduct(user, { label: line.product, terms: line.terms }, { limit: 5 });
      if (status !== "clear") flagged += 1;
      let watchItemId: string | null = null;
      if (body.watch) {
        const label = (line.brand && !line.product.includes(line.brand) ? `${line.brand} ${line.product}` : line.product).slice(0, 120);
        watchItemId = labels.get(label.toLowerCase()) ?? null;
        if (!watchItemId) {
          const wi = await prisma.watchItem.create({
            data: { userId: user.id, kind: "scan", label, terms: line.terms, ocrText: line.raw, context: `From a ${store ?? "store"} receipt${date ? ` on ${date}` : ""}${body.context ? ` · ${body.context}` : ""}`, importedFrom: "receipt" },
          });
          watchItemId = wi.id;
          labels.set(label.toLowerCase(), wi.id);
          await recordAlertsForItem({ ...wi, homeState: user.homeState, lastKnownState: user.lastKnownState }, matches);
        }
      }
      const dietFlags = hasDietSelection(user) ? dietHitsForLabel(`${line.product} ${line.raw}`, user, "receipt") : [];
      items.push({ raw: line.raw, product: line.product, brand: line.brand, terms: line.terms, status, watchItemId, matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })), dietFlags });
    }

    const saved = await prisma.receiptScan.create({
      data: {
        userId: user.id,
        store,
        purchasedAt: date ? new Date(date) : null,
        itemCount: items.length,
        flaggedCount: flagged,
        items: items.map((i) => ({ raw: i.raw, product: i.product, brand: i.brand, terms: i.terms, status: i.status, recallIds: i.matches.map((m) => m.recall.id), watchItemId: i.watchItemId })) as unknown as Prisma.InputJsonValue,
        watched: body.watch,
        decodedByAi,
      },
    });
    return { id: saved.id, store, purchasedAt: date, items, flagged, decodedByAi, watched: body.watch, skippedLines: parsed.skipped };
  });

  app.get("/v1/scan/receipts", async (req) => {
    const user = requireUser(req);
    const rows = await prisma.receiptScan.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 });
    return { items: rows.map((r) => ({ id: r.id, store: r.store, purchasedAt: r.purchasedAt?.toISOString().slice(0, 10) ?? null, itemCount: r.itemCount, flaggedCount: r.flaggedCount, watched: r.watched, createdAt: r.createdAt.toISOString() })) };
  });

  /** Re-check a saved receipt against today's recalls (new recalls land after you shopped). */
  app.get("/v1/scan/receipts/:id", async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const r = await prisma.receiptScan.findFirst({ where: { id, userId: user.id } });
    if (!r) throw new HttpProblem(404, "not_found", "Receipt not found");
    const stored = r.items as unknown as Array<{ raw: string; product: string; brand: string | null; terms: string[]; watchItemId: string | null }>;
    const items: ReceiptItem[] = [];
    let flagged = 0;
    for (const line of stored) {
      const { matches, status } = await checkProduct(user, { label: line.product, terms: line.terms }, { limit: 5 });
      if (status !== "clear") flagged += 1;
      const dietFlags = hasDietSelection(user) ? dietHitsForLabel(`${line.product} ${line.raw}`, user, "receipt") : [];
      items.push({ raw: line.raw, product: line.product, brand: line.brand, terms: line.terms, status, watchItemId: line.watchItemId ?? null, matches: matches.map((m) => ({ recall: serializeRecall(m.recall), reason: m.match.reason, score: m.match.score, explanation: m.match.explanation })), dietFlags });
    }
    if (flagged !== r.flaggedCount) await prisma.receiptScan.update({ where: { id }, data: { flaggedCount: flagged } });
    return { id: r.id, store: r.store, purchasedAt: r.purchasedAt?.toISOString().slice(0, 10) ?? null, items, flagged, decodedByAi: r.decodedByAi, watched: r.watched, skippedLines: 0 };
  });
}
