/**
 * Chicago — Department of Public Health food inspections (Socrata open data).
 * Dataset: https://data.cityofchicago.org/Health-Human-Services/Food-Inspections/4ijn-s7e5
 * One row per inspection with a free-text violations blob. Results: Pass / Pass w/ Conditions /
 * Fail / Out of Business / No Entry / Not Ready.
 */
import { fetchJson } from "../../lib/http.js";
import { normalizeName, pickBestVenue } from "../match.js";
import type { InspectionAdapter, InspectionRecord, InspectionViolation } from "../types.js";

export interface ChicagoRow {
  inspection_id: string;
  dba_name: string;
  aka_name?: string;
  license_?: string;
  facility_type?: string;
  risk?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  inspection_date?: string;
  inspection_type?: string;
  results?: string;
  violations?: string;
  latitude?: string;
  longitude?: string;
}

export const CHICAGO_URL = "https://data.cityofchicago.org/resource/4ijn-s7e5.json";

export function chicagoUrl(opts: { license?: string; name?: string }, appToken?: string): string {
  const params = new URLSearchParams();
  if (opts.license) params.set("license_", opts.license);
  else if (opts.name) params.set("$where", `upper(dba_name) like '%${opts.name.toUpperCase().replace(/'/g, "''").replace(/[%_]/g, "")}%'`);
  params.set("$order", "inspection_date DESC");
  params.set("$limit", "200");
  if (appToken) params.set("$$app_token", appToken);
  return `${CHICAGO_URL}?${params.toString()}`;
}

/** "1. CITY OF CHICAGO ... - Comments: ... | 3. ..." → structured violations. Critical = codes 1–14 (pre-2018) / 1–29 priority in the new scheme; we flag by keyword. */
export function parseChicagoViolations(text: string | undefined): InspectionViolation[] {
  if (!text) return [];
  return text
    .split("|")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(\d+)\.\s*(.*?)(?:\s*-\s*Comments:\s*(.*))?$/s);
      const code = m?.[1] ?? null;
      const title = (m?.[2] ?? chunk).trim();
      const comment = m?.[3]?.trim();
      const n = Number(code);
      const critical = (Number.isFinite(n) && n >= 1 && n <= 29) || /\b(temperature|contaminat|hand ?wash|pest|rodent|sewage|cross)/i.test(title);
      return { code, description: comment ? `${title}. ${comment}` : title, critical };
    });
}

export function chicagoRecord(r: ChicagoRow): (InspectionRecord & { license: string | null; name: string; latitude: number | null; longitude: number | null }) | null {
  if (!r.inspection_date) return null;
  const results = (r.results ?? "").trim();
  if (/out of business|no entry|not ready|business not located/i.test(results)) return null;
  return {
    source: "chicago_cdph",
    externalId: r.license_ ?? null,
    license: r.license_ ?? null,
    name: r.dba_name,
    latitude: r.latitude ? Number(r.latitude) : null,
    longitude: r.longitude ? Number(r.longitude) : null,
    inspectedAt: new Date(r.inspection_date),
    grade: results || null,
    score: null,
    scale: "pass_fail",
    inspectionType: r.inspection_type ?? null,
    violations: parseChicagoViolations(r.violations),
    sourceUrl: `https://webapps1.chicago.gov/healthinspection/inspection.jsp?inspectionID=${r.inspection_id}`,
  };
}

export class ChicagoCdphAdapter implements InspectionAdapter {
  readonly source = "chicago_cdph";
  constructor(private readonly fetcher: <T>(url: string) => Promise<T> = (url) => fetchJson(url), private readonly appToken?: string) {}

  covers(p: { city: string | null; state: string | null }): boolean {
    return p.state?.toUpperCase() === "IL" && (p.city ?? "").trim().toLowerCase() === "chicago";
  }

  async lookup(profile: { name: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null; gradeExternalId: string | null }): Promise<InspectionRecord[]> {
    const rows = await this.fetcher<ChicagoRow[]>(chicagoUrl(profile.gradeExternalId ? { license: profile.gradeExternalId } : { name: normalizeName(profile.name).split(" ").slice(0, 2).join(" ") }, this.appToken));
    const recs = (Array.isArray(rows) ? rows : []).map(chicagoRecord).filter((r): r is NonNullable<typeof r> => !!r);
    if (!recs.length) return [];
    const venues = new Map<string, { name: string; latitude: number | null; longitude: number | null; license: string | null }>();
    for (const r of recs) {
      const k = r.license ?? r.name;
      if (!venues.has(k)) venues.set(k, { name: r.name, latitude: r.latitude, longitude: r.longitude, license: r.license });
    }
    const best = profile.gradeExternalId ? [...venues.values()].find((v) => v.license === profile.gradeExternalId) ?? null : pickBestVenue(profile, [...venues.values()]);
    if (!best) return [];
    return recs.filter((r) => (r.license ?? r.name) === (best.license ?? best.name)).map(({ license: _l, name: _n, latitude: _la, longitude: _lo, ...rec }) => rec);
  }
}
