import type { RestaurantProfile } from "@prisma/client";

export interface InspectionViolation {
  code: string | null;
  description: string;
  critical: boolean;
}

export interface InspectionRecord {
  source: string;
  /** Source-side venue id (CAMIS, license number…) so later refreshes are exact. */
  externalId: string | null;
  inspectedAt: Date;
  grade: string | null;
  score: number | null;
  scale: "letter_abc" | "score_100" | "pass_fail" | "nyc_points";
  inspectionType: string | null;
  violations: InspectionViolation[];
  sourceUrl: string | null;
}

/** A graded venue found by area search, enough to seed a catalog profile. */
export interface DiscoveredVenue {
  source: string;
  externalId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  latest: InspectionRecord | null;
}

export interface InspectionAdapter {
  readonly source: string;
  /** Does this adapter cover the venue's jurisdiction? */
  covers(profile: Pick<RestaurantProfile, "city" | "state">): boolean;
  /** Does this adapter cover a point on the map? */
  coversPoint(lat: number, lng: number): boolean;
  /** Every graded venue within the radius (for the map). */
  discover(lat: number, lng: number, radiusKm: number): Promise<DiscoveredVenue[]>;
  /** All inspections the source has for this venue (newest first). Empty when not found. */
  lookup(profile: Pick<RestaurantProfile, "name" | "city" | "state" | "latitude" | "longitude" | "gradeExternalId">): Promise<InspectionRecord[]>;
}
