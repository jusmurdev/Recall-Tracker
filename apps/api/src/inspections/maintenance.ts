/**
 * Daily upkeep for the shared restaurant catalog. Because research and grades are stored per
 * restaurant (not per user), the catalog is the asset: keep tracked venues fresh without any
 * user lifting a finger, and never discard data someone else may want.
 */
import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { logger } from "../lib/logger.js";
import { isFresh, researchProfile } from "../premium/restaurantResearch.js";
import { syncGrade } from "./sync.js";

export interface MaintenanceReport {
  gradesChecked: number;
  gradeChanges: number;
  researchRefreshed: number;
  pruned: number;
  errors: number;
}

export async function runMaintenance(opts: { now?: Date; research?: boolean } = {}): Promise<MaintenanceReport> {
  const now = opts.now ?? new Date();
  const e = env();
  const report: MaintenanceReport = { gradesChecked: 0, gradeChanges: 0, researchRefreshed: 0, pruned: 0, errors: 0 };

  // 1. Grades: every tracked restaurant whose grade is older than GRADE_REFRESH_DAYS.
  const gradeCutoff = new Date(now.getTime() - e.GRADE_REFRESH_DAYS * 86_400_000);
  const tracked = await prisma.restaurantProfile.findMany({
    where: { watchItems: { some: {} }, OR: [{ gradeCheckedAt: null }, { gradeCheckedAt: { lt: gradeCutoff } }] },
    select: { id: true },
    orderBy: { gradeCheckedAt: "asc" },
    take: 500,
  });
  for (const p of tracked) {
    try {
      const r = await syncGrade(p.id);
      report.gradesChecked += 1;
      if (r.changed) report.gradeChanges += 1;
    } catch {
      report.errors += 1;
    }
  }

  // 2. Research: tracked restaurants whose shared research has gone stale get refreshed at system
  //    expense (no user quota), so the next person always finds a fresh result.
  if (opts.research !== false) {
    const stale = await prisma.restaurantProfile.findMany({
      where: { watchItems: { some: {} }, researchStatus: { in: ["ready", "failed"] } },
      select: { id: true, researchStatus: true, researchedAt: true },
      take: 50,
    });
    for (const p of stale) {
      if (p.researchStatus === "ready" && isFresh(p, now)) continue;
      try {
        await researchProfile(p.id, null);
        report.researchRefreshed += 1;
      } catch {
        report.errors += 1;
      }
    }
  }

  // 3. Prune only what has no value to anyone: untracked, never researched, no grade, idle.
  const pruneCutoff = new Date(now.getTime() - e.PROFILE_PRUNE_DAYS * 86_400_000);
  const pruned = await prisma.restaurantProfile.deleteMany({
    where: { watchItems: { none: {} }, researchedAt: null, currentGrade: null, lastRequestedAt: { lt: pruneCutoff } },
  });
  report.pruned = pruned.count;

  logger.info(report, "restaurant maintenance complete");
  return report;
}
