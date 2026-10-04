/**
 * New York City — DOHMH restaurant inspection results (Socrata open data, no key required for
 * light use; an app token raises limits).
 * Dataset: https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j
 * One row per violation per inspection; we group rows by (camis, inspection_date).
 * Grades: A (0–13 points), B (14–27), C (28+). Lower score is better.
 */
import { fetchJson } from "../../lib/http.js";
import { normalizeName, pickBestVenue } from "../match.js";
import type { InspectionAdapter, InspectionRecord } from "../types.js";

export interface NycRow {
  camis: string;
  dba: string;
  boro?: string;
  building?: string;
  street?: string;
  zipcode?: string;
  inspection_date?: string;
  action?: string;
  violation_code?: string;
  violation_description?: string;
  critical_flag?: string;
  score?: string;
  grade?: string;
  grade_date?: string;
  inspection_type?: string;
  latitude?: string;
  longitude?: string;
}

const NYC_BOROUGHS = new Set(["new york", "nyc", "manhattan", "brooklyn", "queens", "bronx", "the bronx", "staten island", "new york city"]);
export const NYC_URL = "https://data.cityofnewyork.us/resource/43nn-pn8j.json";

export function nycUrl(opts: { camis?: string; name?: string }, appToken?: string): string {
  const params = new URLSearchParams();
  if (opts.camis) params.set("camis", opts.camis);
  else if (opts.name) params.set("$where", `upper(dba) like '%${opts.name.toUpperCase().replace(/'/g, "''").replace(/[%_]/g, "")}%'`);
  params.set("$order", "inspection_date DESC");
  params.set("$limit", "500");
  if (appToken) params.set("$$app_token", appToken);
  return `${NYC_URL}?${params.toString()}`;
}

/** Collapse violation rows into inspection records, newest first. */
export function groupNycRows(rows: NycRow[]): Array<InspectionRecord & { camis: string; name: string; latitude: number | null; longitude: number | null }> {
  const byKey = new Map<string, InspectionRecord & { camis: string; name: string; latitude: number | null; longitude: number | null }>();
  for (const r of rows) {
    if (!r.inspection_date || r.inspection_date.startsWith("1900")) continue; // 1900-01-01 = not yet inspected
    const key = `${r.camis}|${r.inspection_date}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        source: "nyc_dohmh",
        externalId: r.camis,
        camis: r.camis,
        name: r.dba,
        latitude: r.latitude ? Number(r.latitude) : null,
        longitude: r.longitude ? Number(r.longitude) : null,
        inspectedAt: new Date(r.inspection_date),
        grade: r.grade?.trim() || null,
        score: r.score != null && r.score !== "" ? Number(r.score) : null,
        scale: "nyc_points",
        inspectionType: r.inspection_type ?? null,
        violations: [],
        sourceUrl: `https://a816-health.nyc.gov/ABCEatsRestaurants/#!/Search?camis=${r.camis}`,
      };
      byKey.set(key, rec);
    }
    if (r.violation_code || r.violation_description) {
      rec.violations.push({ code: r.violation_code ?? null, description: r.violation_description ?? "", critical: /^y|critical/i.test(r.critical_flag ?? "") && !/not critical/i.test(r.critical_flag ?? "") });
    }
    if (!rec.grade && r.grade) rec.grade = r.grade.trim();
  }
  return [...byKey.values()].sort((a, b) => b.inspectedAt.getTime() - a.inspectedAt.getTime());
}

export class NycDohmhAdapter implements InspectionAdapter {
  readonly source = "nyc_dohmh";
  constructor(private readonly fetcher: <T>(url: string) => Promise<T> = (url) => fetchJson(url), private readonly appToken?: string) {}

  covers(p: { city: string | null; state: string | null }): boolean {
    return p.state?.toUpperCase() === "NY" && !!p.city && NYC_BOROUGHS.has(p.city.trim().toLowerCase());
  }

  async lookup(profile: { name: string; city: string | null; state: string | null; latitude: number | null; longitude: number | null; gradeExternalId: string | null }): Promise<InspectionRecord[]> {
    const rows = await this.fetcher<NycRow[]>(nycUrl(profile.gradeExternalId ? { camis: profile.gradeExternalId } : { name: firstWords(profile.name) }, this.appToken));
    const grouped = groupNycRows(Array.isArray(rows) ? rows : []);
    if (!grouped.length) return [];
    // Choose the venue (CAMIS) whose name/location best matches, then return all its inspections.
    const venues = new Map<string, { name: string; latitude: number | null; longitude: number | null; camis: string }>();
    for (const g of grouped) if (!venues.has(g.camis)) venues.set(g.camis, { name: g.name, latitude: g.latitude, longitude: g.longitude, camis: g.camis });
    const best = profile.gradeExternalId ? venues.get(profile.gradeExternalId) ?? null : pickBestVenue(profile, [...venues.values()]);
    if (!best) return [];
    return grouped.filter((g) => g.camis === best.camis).map(({ camis: _c, name: _n, latitude: _la, longitude: _lo, ...rec }) => rec);
  }
}

function firstWords(name: string): string {
  return normalizeName(name).split(" ").slice(0, 2).join(" ");
}
