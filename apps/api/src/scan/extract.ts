/**
 * Turn raw OCR text from a product label into search terms. Runs on every scan (free tier),
 * so it is deterministic and dependency-free. Premium users can additionally run the
 * Claude-powered identifier in premium/scanIdentify.ts for photos with poor OCR.
 */

const NOISE = new Set([
  "nutrition", "facts", "serving", "servings", "size", "per", "container", "calories", "total", "fat", "saturated",
  "trans", "cholesterol", "sodium", "carbohydrate", "carbohydrates", "dietary", "fiber", "sugars", "sugar", "added",
  "protein", "vitamin", "calcium", "iron", "potassium", "daily", "value", "values", "amount", "ingredients",
  "contains", "may", "contain", "allergen", "allergens", "net", "wt", "weight", "oz", "fl", "ml", "lb", "lbs", "g",
  "mg", "kg", "keep", "refrigerated", "frozen", "store", "cool", "dry", "place", "best", "by", "before", "use",
  "sell", "exp", "expires", "lot", "made", "in", "usa", "distributed", "manufactured", "for", "the", "and", "with",
  "of", "a", "an", "or", "to", "from", "new", "natural", "artificial", "flavors", "flavor", "no", "non", "gmo",
  "gluten", "free", "organic", "certified", "www", "com", "inc", "llc", "co", "ltd", "corp", "questions", "comments",
  "call", "visit", "please", "recycle", "shake", "well", "enjoy", "product", "products", "quality", "guaranteed",
  "since", "est", "original", "real", "premium", "classic", "family", "pack", "count", "ct", "pcs", "piece", "pieces",
]);

export interface ExtractedProduct {
  brand: string | null;
  terms: string[];
  upc: string | null;
}

export function extractFromOcr(ocrText: string | undefined, context?: string, upc?: string): ExtractedProduct {
  const lines = (ocrText ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/[^\p{L}\p{N}'&.\- ]/gu, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 2);

  // Brand heuristic: the first short, mostly-alphabetic line that is not noise.
  let brand: string | null = null;
  for (const line of lines) {
    const words = line.split(" ");
    if (words.length > 4 || line.length > 32) continue;
    const alpha = line.replace(/[^\p{L}]/gu, "").length / Math.max(1, line.length);
    if (alpha < 0.7) continue;
    if (words.every((w) => NOISE.has(w.toLowerCase()))) continue;
    if (/\d{3,}/.test(line)) continue;
    brand = toTitle(line);
    break;
  }

  // Candidate terms: multi-word phrases from short lines + salient single words, ranked by frequency/caps.
  const scores = new Map<string, number>();
  const bump = (term: string, by: number) => {
    const t = term.toLowerCase().trim();
    if (t.length < 3 || /^\d+$/.test(t) || NOISE.has(t)) return;
    scores.set(t, (scores.get(t) ?? 0) + by);
  };
  for (const line of lines) {
    const words = line.split(" ").filter((w) => w.length >= 3 && !NOISE.has(w.toLowerCase()) && !/^\d+$/.test(w));
    if (!words.length) continue;
    const isCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
    if (words.length <= 4 && line.length <= 40) bump(words.join(" "), isCaps ? 3 : 2);
    for (const w of words) bump(w, isCaps ? 1.5 : 1);
    for (let i = 0; i + 1 < words.length && i < 6; i += 1) bump(`${words[i]} ${words[i + 1]}`, 1.2);
  }
  if (brand) bump(brand, 5);

  // User context adds high-weight terms ("Costco Kirkland almond milk").
  for (const phrase of (context ?? "").split(/[,;.\n]/)) {
    const words = phrase.trim().split(/\s+/).filter((w) => w.length >= 3 && !NOISE.has(w.toLowerCase()));
    if (!words.length) continue;
    if (words.length <= 4) bump(words.join(" "), 2.5);
    for (const w of words) bump(w, 1);
  }

  const terms = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .filter((t, i, arr) => !arr.slice(0, i).some((prev) => prev.includes(t) && prev !== t)) // drop words already covered by a kept phrase
    .slice(0, 8);

  const upcClean = upc?.replace(/\D/g, "");
  return { brand, terms, upc: upcClean && upcClean.length >= 8 ? upcClean : null };
}

function toTitle(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
