/**
 * FDA — openFDA Enforcement Reports.
 * Docs: https://open.fda.gov/apis/food/enforcement/  (also /drug/enforcement, /device/enforcement)
 *
 * The enforcement endpoints expose every recall the FDA has classified, including the
 * weekly Enforcement Report entries that never got a press release. This is the primary
 * source for food, dietary supplement, cosmetic, pet food, drug and device recalls.
 *
 * Rate limits: 240 req/min & 1,000 req/day without a key; 120,000/day with a key. We page
 * in blocks of 100 sorted by report_date and only query the window since our watermark.
 */
import { env } from "../../config/env.js";
import { fetchJson } from "../../lib/http.js";
import { cleanText, contentHash, extractBrands, extractRemedy, extractUpcs, parseCompactDate, parseDistributionStates, toYyyymmdd, truncate } from "../normalize.js";
import type { FetchWindow, NormalizedRecall, SourceAdapter } from "../types.js";
import type { RecallCategory, RecallSeverity, RecallStatus } from "@recall/shared";

export type OpenFdaEndpoint = "food" | "drug" | "device";

export interface OpenFdaEnforcementRecord {
  recall_number: string;
  event_id?: string;
  status?: string;
  classification?: string;
  product_type?: string;
  recalling_firm?: string;
  city?: string;
  state?: string;
  country?: string;
  product_description?: string;
  product_quantity?: string;
  reason_for_recall?: string;
  code_info?: string;
  more_code_info?: string;
  distribution_pattern?: string;
  voluntary_mandated?: string;
  initial_firm_notification?: string;
  recall_initiation_date?: string;
  center_classification_date?: string;
  report_date?: string;
  termination_date?: string;
  openfda?: Record<string, unknown>;
}

export interface OpenFdaResponse {
  meta?: { results?: { skip: number; limit: number; total: number } };
  results?: OpenFdaEnforcementRecord[];
  error?: { code: string; message?: string };
}

const PAGE = 100;
const MAX_SKIP = 25_000; // openFDA hard limit

export function openFdaUrl(endpoint: OpenFdaEndpoint, window: FetchWindow, skip: number, apiKey?: string): string {
  const search = `report_date:[${toYyyymmdd(window.since)}+TO+${toYyyymmdd(window.until)}]`;
  const params = [`search=${search}`, `sort=report_date:asc`, `limit=${PAGE}`, `skip=${skip}`];
  if (apiKey) params.push(`api_key=${encodeURIComponent(apiKey)}`);
  return `https://api.fda.gov/${endpoint}/enforcement.json?${params.join("&")}`;
}

export function classifySeverity(classification: string | undefined): RecallSeverity {
  const c = (classification ?? "").toLowerCase().replace(/\s+/g, " ");
  if (c.includes("class i") && !c.includes("class ii")) return "critical";
  if (c.includes("class ii") && !c.includes("class iii")) return "high";
  if (c.includes("class iii")) return "low";
  return "unknown";
}

export function mapStatus(status: string | undefined): RecallStatus {
  switch ((status ?? "").toLowerCase()) {
    case "ongoing":
      return "ongoing";
    case "completed":
      return "completed";
    case "terminated":
      return "terminated";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

export function categorize(rec: OpenFdaEnforcementRecord, endpoint: OpenFdaEndpoint): RecallCategory {
  const type = (rec.product_type ?? "").toLowerCase();
  const desc = `${rec.product_description ?? ""} ${rec.reason_for_recall ?? ""}`.toLowerCase();
  if (endpoint === "drug" || type.includes("drug")) {
    if (/\b(veterinary|animal|canine|feline|equine|for dogs|for cats)\b/.test(desc)) return "veterinary";
    return "drug";
  }
  if (endpoint === "device" || type.includes("device")) return "medical_device";
  if (type.includes("cosmetic") || /\b(shampoo|lotion|mascara|lipstick|eye ?liner|sunscreen|deodorant|toothpaste|cosmetic)\b/.test(desc)) return "cosmetic";
  if (/\b(dietary supplement|supplement|capsules?|softgels?|gummies|vitamin|probiotic|protein powder)\b/.test(desc)) return "dietary_supplement";
  if (/\b(dog|cat|pet|puppy|kitten|animal feed|livestock|poultry feed|horse|bird seed)\b/.test(desc) && /\b(food|treats?|chews?|feed|kibble)\b/.test(desc)) return "veterinary";
  return "food";
}

export function normalizeFdaRecord(rec: OpenFdaEnforcementRecord, endpoint: OpenFdaEndpoint): NormalizedRecall {
  const product = cleanText(rec.product_description);
  const reason = cleanText(rec.reason_for_recall);
  const company = cleanText(rec.recalling_firm);
  const codeInfo = `${rec.code_info ?? ""} ${rec.more_code_info ?? ""}`;
  const reportDate = parseCompactDate(rec.report_date);
  const initiation = parseCompactDate(rec.recall_initiation_date);
  const classified = parseCompactDate(rec.center_classification_date);
  const publishedAt = reportDate ?? classified ?? initiation ?? new Date();
  const titleProduct = truncate(product.split(/[.;\n]/)[0]?.trim() || product, 110);
  const r: NormalizedRecall = {
    source: "FDA",
    sourceId: rec.recall_number,
    title: `${company ? `${company}: ` : ""}${titleProduct}`,
    summary: truncate(`${reason}${rec.distribution_pattern ? ` Distribution: ${cleanText(rec.distribution_pattern)}` : ""}`, 2000),
    productDescription: truncate(product, 4000),
    reason: truncate(reason, 2000),
    category: categorize(rec, endpoint),
    severity: classifySeverity(rec.classification),
    status: mapStatus(rec.status),
    company,
    brands: extractBrands(product),
    upcs: extractUpcs(`${product} ${codeInfo}`),
    distributionStates: parseDistributionStates(rec.distribution_pattern),
    recallDate: initiation,
    publishedAt,
    sourceUpdatedAt: reportDate,
    url: rec.recall_number
      ? `https://www.accessdata.fda.gov/scripts/ires/index.cfm?Product=${encodeURIComponent(rec.recall_number)}`
      : null,
    imageUrls: [],
    codeInfo: cleanText(codeInfo) || null,
    // Enforcement reports rarely carry consumer instructions; derive a sensible default from
    // the status and classification so the app can always show "what to do".
    remedy:
      extractRemedy(`${product} ${reason}`) ??
      (rec.status?.toLowerCase() === "ongoing"
        ? "Check the lot/date codes on your package. If they match, do not use the product; return it to the place of purchase for a refund or discard it, and contact the company with questions."
        : null),
    raw: rec,
  };
  return r;
}

export class FdaAdapter implements SourceAdapter {
  readonly source = "FDA" as const;

  constructor(
    private readonly endpoints: OpenFdaEndpoint[],
    private readonly fetcher: <T>(url: string) => Promise<T> = (url) => fetchJson(url),
  ) {}

  async fetch(window: FetchWindow): Promise<NormalizedRecall[]> {
    const apiKey = env().OPENFDA_API_KEY;
    const out: NormalizedRecall[] = [];
    for (const endpoint of this.endpoints) {
      let skip = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const body = await this.fetcher<OpenFdaResponse>(openFdaUrl(endpoint, window, skip, apiKey));
        if (body.error?.code === "NOT_FOUND" || !body.results?.length) break;
        for (const rec of body.results) {
          if (!rec.recall_number) continue;
          out.push(normalizeFdaRecord(rec, endpoint));
        }
        const total = body.meta?.results?.total ?? 0;
        skip += body.results.length;
        if (skip >= total || skip >= MAX_SKIP || body.results.length < PAGE) break;
      }
    }
    return dedupeBySourceId(out);
  }
}

export function dedupeBySourceId(items: NormalizedRecall[]): NormalizedRecall[] {
  const map = new Map<string, NormalizedRecall>();
  for (const it of items) {
    const prev = map.get(it.sourceId);
    if (!prev || (it.sourceUpdatedAt?.getTime() ?? 0) >= (prev.sourceUpdatedAt?.getTime() ?? 0)) map.set(it.sourceId, it);
  }
  return [...map.values()];
}

export { contentHash };
