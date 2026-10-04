/**
 * New York City — DOHMH restaurant inspection results (Socrata open data, no key required for
 * light use; an app token raises limits).
 * Dataset: https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j
 * One row per violation per inspection; we group rows by (camis, inspection_date).
 * Grades: A (0–13 points), B (14–27), C (28+). Lower score is better.
 */
import { fetchJson } from "../../lib/http.js";
import { normalizeName, pickBestVenue } from "../match.js";
import type { DiscoveredVenue, InspectionAdapter, InspectionRecord } from "../types.js";

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

export function nycUrl(opts: { camis?: string; name?: string; box?: { minLat: number; maxLat: number; minLng: number; maxLng: number } }, appToken?: string): string {
  const params = new URLSearchParams();
  if (opts.camis) params.set("camis", opts.camis);
  else if (opts.box) params.set("$where", `latitude between ${opts.box.minLat} and ${opts.box.maxLat} AND longitude between ${opts.box.minLng} and ${opts.box.maxLng} AND inspection_date > '2000-01-01'`);
  else if (opts.name) params.set("$where", `upper(dba) like '%${opts.name.toUpperCase().replace(/'/g, "''").replace(/[%_]/g, "")}%'`);
  params.set("$order", "inspection_date DESC");
  params.set("$limit", opts.box ? "5000" : "500");
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

  /** Rough NYC bounding box. */
  coversPoint(lat: number, lng: number): boolean {
    return lat >= 40.49 && lat <= 40.92 && lng >= -74.27 && lng <= -73.68;
  }

  async discover(lat: number, lng: number, radiusKm: number): Promise<DiscoveredVenue[]> {
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
    const rows = await this.fetcher<NycRow[]>(nycUrl({ box: { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng } }, this.appToken));
    const grouped = groupNycRows(Array.isArray(rows) ? rows : []);
    const byCamis = new Map<string, DiscoveredVenue>();
    for (const g of grouped) {
      if (g.latitude == null || g.longitude == null) continue;
      if (haversineKm(lat, lng, g.latitude, g.longitude) > radiusKm) continue;
      const raw = rows.find((r) => r.camis === g.camis);
      const existing = byCamis.get(g.camis);
      const { camis, name, latitude, longitude, ...rec } = g;
      if (!existing) {
        byCamis.set(camis, { source: this.source, externalId: camis, name: titleCase(name), address: raw?.building && raw.street ? `${raw.building} ${titleCase(raw.street)}` : null, city: raw?.boro ? titleCase(raw.boro) : "New York", state: "NY", latitude, longitude, latest: rec.grade || rec.score != null ? rec : null });
      } else if (!existing.latest && (rec.grade || rec.score != null)) existing.latest = rec;
    }
    return [...byCamis.values()];
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

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(x));
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Llc|Inc|Dba)\b/g, (m) => m.toUpperCase());
}

function firstWords(name: string): string {
  return normalizeName(name).split(" ").slice(0, 2).join(" ");
}
