import type { Alert as DbAlert, Connector as DbConnector, Recall as DbRecall, WatchItem as DbWatchItem } from "@prisma/client";
import type { Alert, Connector, Recall, WatchItem } from "@recall/shared";
import { cleanHeadline } from "../ingest/headline.js";

export function serializeRecall(r: DbRecall): Recall {
  return {
    id: r.id,
    source: r.source,
    sourceId: r.sourceId,
    title: r.title,
    summary: r.summary,
    productDescription: r.productDescription,
    reason: r.reason,
    category: r.category,
    severity: r.severity,
    status: r.status,
    company: r.company,
    brands: r.brands,
    upcs: r.upcs,
    distributionStates: r.distributionStates,
    recallDate: r.recallDate?.toISOString() ?? null,
    publishedAt: r.publishedAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    url: r.url,
    imageUrls: r.imageUrls,
    codeInfo: r.codeInfo,
    remedy: r.remedy,
    headline: cleanHeadline(r),
  };
}

type WatchItemWithProfile = DbWatchItem & { restaurantProfile?: { latitude: number | null; longitude: number | null } | null };

export function serializeWatchItem(w: WatchItemWithProfile): WatchItem {
  return {
    id: w.id,
    userId: w.userId,
    kind: w.kind,
    label: w.label,
    terms: w.terms,
    upc: w.upc ?? undefined,
    context: w.context ?? undefined,
    ocrText: w.ocrText ?? undefined,
    categories: w.categories,
    minSeverity: w.minSeverity ?? undefined,
    restaurant: w.restaurantName
      ? {
          name: w.restaurantName,
          city: w.restaurantCity ?? undefined,
          state: w.restaurantState ?? undefined,
          website: w.restaurantWebsite ?? undefined,
          latitude: w.restaurantProfile?.latitude ?? undefined,
          longitude: w.restaurantProfile?.longitude ?? undefined,
        }
      : undefined,
    createdAt: w.createdAt.toISOString(),
    importedFrom: w.importedFrom,
    researchSummary: w.researchSummary,
    researchUpdatedAt: w.researchUpdatedAt?.toISOString() ?? null,
  };
}

export function serializeAlert(a: DbAlert & { recall: DbRecall; watchItem: { label: string } | null }): Alert {
  return {
    id: a.id,
    recall: serializeRecall(a.recall),
    watchItemId: a.watchItemId,
    watchItemLabel: a.watchItem?.label ?? null,
    reason: a.reason,
    score: a.score,
    explanation: a.explanation,
    createdAt: a.createdAt.toISOString(),
    readAt: a.readAt?.toISOString() ?? null,
    pushedAt: a.pushedAt?.toISOString() ?? null,
    dismissedAt: a.dismissedAt?.toISOString() ?? null,
    dismissReason: (a.dismissReason as Alert["dismissReason"]) ?? null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedAction: (a.resolvedAction as Alert["resolvedAction"]) ?? null,
  };
}

export function serializeConnector(c: DbConnector): Connector {
  return {
    id: c.id,
    provider: c.provider as Connector["provider"],
    displayName: c.displayName,
    mcpUrl: c.mcpUrl,
    hasToken: !!c.tokenCiphertext,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: c.lastSyncStatus as Connector["lastSyncStatus"],
    lastSyncError: c.lastSyncError,
    createdAt: c.createdAt.toISOString(),
  };
}
