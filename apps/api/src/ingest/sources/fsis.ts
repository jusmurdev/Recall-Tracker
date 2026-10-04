/**
 * USDA FSIS — Food Safety and Inspection Service recalls & public health alerts.
 * API: https://www.fsis.usda.gov/fsis/api/recall/v/1   (JSON, no key)
 * Docs: https://www.fsis.usda.gov/science-data/developer-resources/recall-api
 *
 * FSIS covers meat, poultry and egg products (the FDA does not). The endpoint returns the
 * full list of recent recalls in one response; we filter client-side on last-modified /
 * recall date because the server-side filters are taxonomy-id based and undocumented.
 */
import { fetchJson } from "../../lib/http.js";
import { cleanText, extractBrands, extractRemedy, extractUpcs, parseDistributionStates, parseLooseDate, truncate } from "../normalize.js";
import type { FetchWindow, NormalizedRecall, SourceAdapter } from "../types.js";
import type { RecallSeverity, RecallStatus } from "@recall/shared";

export interface FsisRecord {
  field_title: string;
  field_recall_number: string;
  field_recall_date?: string;
  field_recall_type?: string;
  field_recall_classification?: string;
  field_risk_level?: string;
  field_recall_reason?: string;
  field_summary?: string;
  field_product_items?: string;
  field_establishment?: string;
  field_states?: string;
  field_recall_url?: string;
  field_active_notice?: string;
  field_closed_date?: string;
  field_last_modified_date?: string;
  field_labels?: string;
  field_processing?: string;
  field_year?: string;
  field_related_to_outbreak?: string;
  field_qty_recovered?: string;
  field_archive_recall?: string;
  langcode?: string;
  [k: string]: unknown;
}

export const FSIS_URL = "https://www.fsis.usda.gov/fsis/api/recall/v/1";

export function fsisSeverity(rec: FsisRecord): RecallSeverity {
  const cls = (rec.field_recall_classification ?? "").toLowerCase();
  if (/class i\b/.test(cls) && !/class ii/.test(cls)) return "critical";
  if (/class ii\b/.test(cls) && !/class iii/.test(cls)) return "high";
  if (/class iii/.test(cls)) return "low";
  const risk = (rec.field_risk_level ?? "").toLowerCase();
  if (risk.startsWith("high")) return "critical";
  if (risk.startsWith("medium")) return "high";
  if (risk.startsWith("low") || risk.startsWith("marginal")) return "low";
  return "unknown";
}

export function fsisStatus(rec: FsisRecord): RecallStatus {
  if (rec.field_closed_date && rec.field_closed_date.trim()) return "completed";
  const active = (rec.field_active_notice ?? "").toLowerCase();
  if (active === "true" || active === "1" || active === "yes") return "ongoing";
  if (active === "false" || active === "0" || active === "no") return "completed";
  return "unknown";
}

function stripEstablishment(s: string): string {
  // "EST. 12345" → company name is often in the title: "Acme Foods Recalls ..." handled by caller.
  return cleanText(s);
}

export function companyFromTitle(title: string): string {
  const m = title.match(/^(.*?)\s+(?:Recalls|Issues|Announces|Expands|Initiates)\b/i);
  return m ? m[1]!.trim() : "";
}

export function normalizeFsisRecord(rec: FsisRecord): NormalizedRecall {
  const title = cleanText(rec.field_title);
  const summary = cleanText(rec.field_summary);
  const products = cleanText(rec.field_product_items);
  const recallDate = parseLooseDate(rec.field_recall_date);
  const modified = parseLooseDate(rec.field_last_modified_date);
  const isAlert = /public health alert/i.test(rec.field_recall_type ?? "");
  const company = companyFromTitle(title) || stripEstablishment(rec.field_establishment ?? "");
  const url = rec.field_recall_url
    ? rec.field_recall_url.startsWith("http")
      ? rec.field_recall_url
      : `https://www.fsis.usda.gov${rec.field_recall_url}`
    : null;
  return {
    source: "FSIS",
    sourceId: rec.field_recall_number || title,
    title: isAlert && !/alert/i.test(title) ? `Public Health Alert: ${title}` : title,
    summary: truncate(summary, 2000),
    productDescription: truncate(products || summary, 4000),
    reason: truncate(cleanText(rec.field_recall_reason) || summary.split(/[.\n]/)[0] || "", 2000),
    category: "meat_poultry",
    severity: isAlert && fsisSeverity(rec) === "unknown" ? "high" : fsisSeverity(rec),
    status: fsisStatus(rec),
    company,
    brands: extractBrands(`${title} ${products}`),
    upcs: extractUpcs(`${products} ${summary} ${rec.field_labels ?? ""}`),
    distributionStates: parseDistributionStates(rec.field_states),
    recallDate,
    publishedAt: recallDate ?? modified ?? new Date(),
    sourceUpdatedAt: modified,
    url,
    imageUrls: [],
    codeInfo: extractCodes(products) || null,
    remedy:
      extractRemedy(summary) ??
      "FSIS is concerned that some product may be in consumers' refrigerators or freezers. Consumers who have purchased these products are urged not to consume them. These products should be thrown away or returned to the place of purchase.",
    raw: rec,
  };
}

/** Lot codes, establishment numbers, and date ranges embedded in FSIS product descriptions. */
function extractCodes(products: string): string {
  const hits = new Set<string>();
  for (const m of products.matchAll(/\b(?:lot(?: code| number)?s?|est\.?|p-?|use[- ]by|sell[- ]by|best[- ](?:by|before)|pack(?:ed)? (?:on|date))\s*[:#]?\s*([A-Za-z0-9/\-–,. ]{3,60}?)(?=[.;)]|$| and | with | or )/gi)) {
    hits.add(cleanText(m[0]!));
  }
  return [...hits].slice(0, 12).join("; ");
}

export class FsisAdapter implements SourceAdapter {
  readonly source = "FSIS" as const;

  constructor(private readonly fetcher: <T>(url: string) => Promise<T> = (url) => fetchJson(url)) {}

  async fetch(window: FetchWindow): Promise<NormalizedRecall[]> {
    const body = await this.fetcher<FsisRecord[] | { data?: FsisRecord[] }>(FSIS_URL);
    const records = Array.isArray(body) ? body : (body.data ?? []);
    const out: NormalizedRecall[] = [];
    for (const rec of records) {
      if (!rec || typeof rec !== "object" || !rec.field_title) continue;
      if (rec.langcode && rec.langcode !== "English") continue; // Spanish duplicates share the recall number
      const n = normalizeFsisRecord(rec);
      const stamp = n.sourceUpdatedAt ?? n.publishedAt;
      if (stamp < window.since || n.publishedAt > addDays(window.until, 1)) continue;
      out.push(n);
    }
    return out;
  }
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}
