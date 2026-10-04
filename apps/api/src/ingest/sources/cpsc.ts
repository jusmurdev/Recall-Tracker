/**
 * CPSC — Consumer Product Safety Commission recalls.
 * API: https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=YYYY-MM-DD
 * Docs: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
 *
 * Non-food consumer products (appliances, toys, furniture, kitchenware). Included because
 * users scan "physical items" and many kitchen/drink products (bottles, blenders, mugs)
 * fall under CPSC rather than FDA.
 */
import { fetchJson } from "../../lib/http.js";
import { cleanText, extractUpcs, parseLooseDate, toIsoDate, truncate } from "../normalize.js";
import type { FetchWindow, NormalizedRecall, SourceAdapter } from "../types.js";
import type { RecallSeverity } from "@recall/shared";

interface Named {
  Name?: string;
}
export interface CpscRecord {
  RecallID: number;
  RecallNumber?: string;
  RecallDate?: string;
  Description?: string;
  URL?: string;
  Title?: string;
  ConsumerContact?: string;
  LastPublishDate?: string;
  Products?: Array<{ Name?: string; Description?: string; Model?: string; Type?: string; NumberOfUnits?: string }>;
  Images?: Array<{ URL?: string }>;
  Injuries?: Named[];
  Manufacturers?: Named[];
  ManufacturerCountries?: Array<{ Country?: string }>;
  ProductUPCs?: Array<{ UPC?: string }>;
  Hazards?: Array<{ Name?: string; HazardTypeID?: string }>;
  Remedies?: Named[];
  Retailers?: Named[];
  Distributors?: Named[];
  Importers?: Named[];
  SoldAtLabel?: string;
}

export function cpscUrl(window: FetchWindow): string {
  return `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=${toIsoDate(window.since)}&RecallDateEnd=${toIsoDate(window.until)}`;
}

export function cpscSeverity(rec: CpscRecord): RecallSeverity {
  const injuries = (rec.Injuries ?? []).map((i) => (i.Name ?? "").toLowerCase()).join(" ");
  const hazards = (rec.Hazards ?? []).map((h) => (h.Name ?? "").toLowerCase()).join(" ");
  if (/\b(death|died|fatal)/.test(injuries)) return "critical";
  if (/\b(hospitali[sz]|serious|burn|lacerat|fracture|poison|choking|strangulat|suffocat|entrap|lead\b|carbon monoxide|fire|electrocut|shock)/.test(`${injuries} ${hazards}`)) return "high";
  if (hazards || injuries) return "low";
  return "unknown";
}

export function normalizeCpscRecord(rec: CpscRecord): NormalizedRecall {
  const title = cleanText(rec.Title);
  const desc = cleanText(rec.Description);
  const products = (rec.Products ?? []).map((p) => cleanText(p.Name ?? p.Description ?? "")).filter(Boolean);
  const hazards = (rec.Hazards ?? []).map((h) => cleanText(h.Name ?? "")).filter(Boolean);
  const injuries = (rec.Injuries ?? []).map((i) => cleanText(i.Name ?? "")).filter(Boolean);
  const retailers = (rec.Retailers ?? []).map((r) => cleanText(r.Name ?? "")).filter(Boolean);
  const manufacturers = (rec.Manufacturers ?? []).map((m) => cleanText(m.Name ?? "")).filter(Boolean);
  const upcs = new Set<string>();
  for (const u of rec.ProductUPCs ?? []) {
    const digits = (u.UPC ?? "").replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) upcs.add(digits);
  }
  for (const u of extractUpcs(desc)) upcs.add(u);
  const recallDate = parseLooseDate(rec.RecallDate);
  const published = parseLooseDate(rec.LastPublishDate) ?? recallDate ?? new Date();
  const brands = manufacturers.length ? manufacturers : [];
  const reasonParts = [hazards.join("; "), injuries.length ? `Reported: ${injuries.join("; ")}` : ""].filter(Boolean);
  return {
    source: "CPSC",
    sourceId: rec.RecallNumber || String(rec.RecallID),
    title: truncate(title || products[0] || `CPSC recall ${rec.RecallNumber ?? rec.RecallID}`, 200),
    summary: truncate(`${desc}${retailers.length ? `\nSold at: ${retailers.join(", ")}` : ""}`, 2000),
    productDescription: truncate(products.join("\n") || desc, 4000),
    reason: truncate(reasonParts.join(". ") || desc.split(/[.\n]/)[0] || "", 2000),
    category: "consumer_product",
    severity: cpscSeverity(rec),
    status: "ongoing",
    company: manufacturers[0] ?? (rec.Importers ?? [])[0]?.Name ?? (rec.Distributors ?? [])[0]?.Name ?? "",
    brands,
    upcs: [...upcs],
    distributionStates: ["US"],
    recallDate,
    publishedAt: recallDate ?? published,
    sourceUpdatedAt: published,
    url: rec.URL ?? null,
    imageUrls: (rec.Images ?? []).map((i) => i.URL ?? "").filter(Boolean).slice(0, 6),
    raw: rec,
  };
}

export class CpscAdapter implements SourceAdapter {
  readonly source = "CPSC" as const;

  constructor(private readonly fetcher: <T>(url: string) => Promise<T> = (url) => fetchJson(url)) {}

  async fetch(window: FetchWindow): Promise<NormalizedRecall[]> {
    const body = await this.fetcher<CpscRecord[]>(cpscUrl(window));
    if (!Array.isArray(body)) return [];
    return body.filter((r) => r && typeof r.RecallID === "number").map(normalizeCpscRecord);
  }
}
