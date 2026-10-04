/**
 * PREMIUM, optional: when an AI provider is configured, ask it what ambiguous ingredient words on
 * a label probably derive from ("gelatin", "natural flavors", "enzymes"). The model sees only
 * the label text and the ambiguous words, never the user's profile. Its answer can upgrade an
 * ambiguous hit to a likely one; it can never remove a deterministic hit.
 */
import { z } from "zod/v4";
import type { DietHit, DietProfile } from "@recall/shared";
import { PremiumUnavailableError, QuotaExceededError, assertQuota, runStructured } from "../ai/index.js";
import { logger } from "../lib/logger.js";

const Source = z.enum(["pork", "other_animal", "alcohol", "milk", "egg", "fish", "shellfish", "tree_nut", "peanut", "wheat_gluten", "soy", "sesame", "plant_or_synthetic", "unknown"]);
const Classification = z.object({
  items: z.array(
    z.object({
      term: z.string(),
      likelySources: z.array(Source).max(4),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string().max(160),
    }),
  ),
});

const SOURCE_TO_PROFILE: Record<z.infer<typeof Source>, DietProfile[]> = {
  pork: ["halal", "kosher", "vegan"],
  other_animal: ["halal", "kosher", "vegan"],
  alcohol: ["halal"],
  milk: ["allergy_milk", "vegan"],
  egg: ["allergy_egg", "vegan"],
  fish: ["allergy_fish", "vegan"],
  shellfish: ["allergy_shellfish", "kosher", "vegan"],
  tree_nut: ["allergy_tree_nut"],
  peanut: ["allergy_peanut"],
  wheat_gluten: ["allergy_wheat", "gluten_free"],
  soy: ["allergy_soy"],
  sesame: ["allergy_sesame"],
  plant_or_synthetic: [],
  unknown: [],
};

/**
 * Upgrade ambiguous hits the model is confident about. Returns the same list with `kind` and
 * `explanation` adjusted; certain hits are untouched.
 */
export async function refineAmbiguousHits(userId: string, labelText: string, hits: DietHit[]): Promise<DietHit[]> {
  const ambiguous = hits.filter((h) => h.kind === "ambiguous");
  if (!ambiguous.length) return hits;
  try {
    await assertQuota(userId);
    const terms = [...new Set(ambiguous.map((h) => h.term))];
    const { data } = await runStructured(userId, {
      feature: "diet_classify",
      prompt: `A food label lists these ingredients:\n\n${labelText.slice(0, 2500)}\n\nFor each of the following ingredient words, say what it most likely derives from in this product, given the surrounding ingredients and typical US manufacturing: ${terms.join(", ")}. Use "unknown" when the label gives no clue. Be conservative; a wrong "plant_or_synthetic" could harm someone.`,
      schema: Classification,
      maxTokens: 1500,
      effort: "low",
    });
    const byTerm = new Map(data.items.map((i) => [i.term.toLowerCase(), i]));
    return hits.map((h) => {
      if (h.kind !== "ambiguous") return h;
      const c = byTerm.get(h.term.toLowerCase());
      if (!c || c.confidence === "low") return h;
      const profiles = new Set(c.likelySources.flatMap((s) => SOURCE_TO_PROFILE[s]));
      if (!profiles.has(h.profile as DietProfile)) return h; // never downgrade: stays "might contain"
      return { ...h, kind: "mention", explanation: `${h.explanation.split(". ")[0]}. Likely source per AI: ${c.note || c.likelySources.join(", ")}.` };
    });
  } catch (err) {
    if (err instanceof PremiumUnavailableError || err instanceof QuotaExceededError) return hits;
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "diet ambiguity classification failed; keeping deterministic hits");
    return hits;
  }
}
