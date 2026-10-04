import type { RestaurantProfile } from "@prisma/client";
import type { RestaurantGrade } from "@recall/shared";

export type GradeLevel = RestaurantGrade["level"];

/** Translate any jurisdiction's grade into a traffic-light level and a plain-language label. */
export function interpretGrade(grade: string | null, score: number | null, scale: string | null): { level: GradeLevel; label: string | null } {
  const g = (grade ?? "").trim().toUpperCase();
  if (scale === "nyc_points" || scale === "letter_abc" || /^[ABC]$/.test(g)) {
    if (g === "A") return { level: "good", label: "A — excellent" };
    if (g === "B") return { level: "ok", label: "B — some violations" };
    if (g === "C") return { level: "poor", label: "C — significant violations" };
    if (g === "Z" || g === "P") return { level: "ok", label: "Grade pending" };
    if (g === "N") return { level: "unknown", label: "Not yet graded" };
    if (scale === "nyc_points" && score != null) {
      if (score <= 13) return { level: "good", label: `${score} points — A range` };
      if (score <= 27) return { level: "ok", label: `${score} points — B range` };
      return { level: "poor", label: `${score} points — C range` };
    }
  }
  if (scale === "pass_fail" || /pass|fail/i.test(g)) {
    if (/^pass$/i.test(g)) return { level: "good", label: "Pass" };
    if (/pass w\/? ?conditions|conditional/i.test(g)) return { level: "ok", label: "Pass with conditions" };
    if (/fail/i.test(g)) return { level: "poor", label: "Fail — closed or re-inspection required" };
  }
  if (scale === "score_100" || (score != null && !grade)) {
    const s = score ?? Number(g);
    if (Number.isFinite(s)) {
      if (s >= 90) return { level: "good", label: `${s}/100` };
      if (s >= 80) return { level: "ok", label: `${s}/100` };
      return { level: "poor", label: `${s}/100 — low` };
    }
  }
  return grade ? { level: "unknown", label: grade } : { level: "unknown", label: null };
}

export function gradeOf(p: Pick<RestaurantProfile, "currentGrade" | "currentScore" | "gradeScale" | "gradeSource" | "lastInspectedAt" | "gradeCheckedAt">): RestaurantGrade {
  const { level, label } = interpretGrade(p.currentGrade, p.currentScore, p.gradeScale);
  return {
    grade: p.currentGrade,
    score: p.currentScore,
    scale: (p.gradeScale as RestaurantGrade["scale"]) ?? null,
    source: p.gradeSource,
    lastInspectedAt: p.lastInspectedAt?.toISOString() ?? null,
    checkedAt: p.gradeCheckedAt?.toISOString() ?? null,
    label,
    level,
  };
}

const RANK: Record<GradeLevel, number> = { good: 3, ok: 2, poor: 1, unknown: 0 };

/** Did the grade get worse / better? Null when not comparable. */
export function compareLevels(prev: GradeLevel, next: GradeLevel): "worse" | "better" | "same" | null {
  if (prev === "unknown" || next === "unknown") return null;
  if (RANK[next] < RANK[prev]) return "worse";
  if (RANK[next] > RANK[prev]) return "better";
  return "same";
}
