import type { RecallCategory, RecallSeverity, RecallSource, RecallStatus } from "@recall/shared";

/** A recall as produced by a source adapter, before it is persisted. */
export interface NormalizedRecall {
  source: RecallSource;
  sourceId: string;
  title: string;
  summary: string;
  productDescription: string;
  reason: string;
  category: RecallCategory;
  severity: RecallSeverity;
  status: RecallStatus;
  company: string;
  brands: string[];
  upcs: string[];
  distributionStates: string[];
  recallDate: Date | null;
  publishedAt: Date;
  sourceUpdatedAt: Date | null;
  url: string | null;
  imageUrls: string[];
  /** Lot / date / model codes a consumer compares with their package. */
  codeInfo: string | null;
  /** Agency/firm guidance: return, discard, contact… */
  remedy: string | null;
  raw: unknown;
}

export interface FetchWindow {
  /** Inclusive start (UTC). */
  since: Date;
  /** Inclusive end (UTC). */
  until: Date;
}

export interface SourceAdapter {
  readonly source: RecallSource;
  /** Fetch everything published/updated in the window and normalise it. */
  fetch(window: FetchWindow): Promise<NormalizedRecall[]>;
}
