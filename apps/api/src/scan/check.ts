/**
 * The one place that turns "some product text" into a verdict. The label scanner, the receipt
 * checker and the saved-receipt re-check all call this, so a product can never be "fine" on one
 * screen and "recalled" on another.
 */
import type { User } from "@prisma/client";
import type { ReceiptItemStatus } from "@recall/shared";
import { findRecallsForItem, type RecallMatch } from "../matching/engine.js";

/** Matches below this are not worth showing: a generic word or two in common. */
export const MIN_MATCH_SCORE = 0.45;
/** At or above this the product is treated as recalled; between, as "possible". */
export const RECALLED_SCORE = 0.65;

export interface ProductProbe {
  label: string;
  terms: string[];
  upc?: string | null;
  context?: string | null;
}

export interface ProductCheck {
  matches: RecallMatch[];
  status: ReceiptItemStatus;
  /** Highest score among the matches (0 when none). */
  confidence: number;
}

export function verdictFor(score: number): ReceiptItemStatus {
  if (score >= RECALLED_SCORE) return "recalled";
  if (score >= MIN_MATCH_SCORE) return "possible";
  return "clear";
}

/** Check one product (typed, scanned or read off a receipt) against recent recalls. */
export async function checkProduct(user: Pick<User, "id" | "homeState" | "lastKnownState">, probe: ProductProbe, opts: { limit?: number; lookbackDays?: number } = {}): Promise<ProductCheck> {
  const item = {
    id: "probe",
    userId: user.id,
    kind: "scan" as const,
    label: probe.label,
    terms: probe.terms,
    upc: probe.upc ?? null,
    categories: [],
    homeState: user.homeState,
    lastKnownState: user.lastKnownState,
  };
  const all = await findRecallsForItem(item, { limit: opts.limit ?? 10, lookbackDays: opts.lookbackDays });
  const matches = all.filter((m) => m.match.score >= MIN_MATCH_SCORE);
  const confidence = matches[0]?.match.score ?? 0;
  return { matches, status: verdictFor(confidence), confidence };
}
