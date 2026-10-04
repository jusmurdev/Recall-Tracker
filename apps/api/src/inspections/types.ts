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

export interface InspectionAdapter {
  readonly source: string;
  /** Does this adapter cover the venue's jurisdiction? */
  covers(profile: Pick<RestaurantProfile, "city" | "state">): boolean;
  /** All inspections the source has for this venue (newest first). Empty when not found. */
  lookup(profile: Pick<RestaurantProfile, "name" | "city" | "state" | "latitude" | "longitude" | "gradeExternalId">): Promise<InspectionRecord[]>;
}
