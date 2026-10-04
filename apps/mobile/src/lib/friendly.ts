/**
 * Plain-language helpers. Agencies write for lawyers; we write for someone holding a jar.
 */
import type { Alert, Recall, RecallCategory, RecallSeverity, RestaurantGrade } from "@recall/shared";

export const SEVERITY: Record<RecallSeverity, { label: string; short: string; advice: string }> = {
  critical: { label: "Serious", short: "Serious", advice: "Could cause serious illness. Don't use it." },
  high: { label: "Moderate", short: "Moderate", advice: "Could make you sick. Best not to use it." },
  low: { label: "Minor", short: "Minor", advice: "Unlikely to hurt you, but worth knowing." },
  unknown: { label: "Unrated", short: "Unrated", advice: "The agency hasn't rated this one yet." },
};

export const CATEGORY_EMOJI: Record<RecallCategory, string> = {
  food: "🥫",
  meat_poultry: "🍗",
  dietary_supplement: "💊",
  cosmetic: "🧴",
  drug: "💉",
  medical_device: "🩺",
  veterinary: "🐾",
  consumer_product: "🧰",
  other: "📦",
};

export const CATEGORY_FRIENDLY: Record<RecallCategory, string> = {
  food: "Food & drink",
  meat_poultry: "Meat & poultry",
  dietary_supplement: "Vitamins & supplements",
  cosmetic: "Beauty & personal care",
  drug: "Medicine",
  medical_device: "Medical devices",
  veterinary: "Pet food & pet products",
  consumer_product: "Household products",
  other: "Other",
};

/** "J.M. Smucker Co.: Jif Creamy Peanut Butter, 16 oz plastic jar, UPC 0 51500 24128 1" → "Jif Creamy Peanut Butter" */
export function headline(recall: Pick<Recall, "title" | "productDescription" | "source"> & { headline?: string }): string {
  // The server sends a cleaned headline (company prefix removed, shouting fixed, codes dropped).
  if (recall.headline && recall.headline.trim()) return recall.headline;
  let t = recall.title;
  const colon = t.indexOf(": ");
  if (colon > 0 && colon < 60) t = t.slice(colon + 2);
  t = t.replace(/\s*\(?UPC[^,)]*\)?/i, "");
  t = t.replace(/^(Public Health Alert:\s*)/i, "");
  // Agency headlines: "Acme Foods Recalls Ready-To-Eat Liverwurst Products Due to Possible Listeria" → "Ready-To-Eat Liverwurst Products"
  const m = t.match(/\b(?:recalls|issues (?:a )?public health alert for)\s+(.+?)(?:\s+(?:due to|because of|for possible|over)\b.*)?$/i);
  if (m) t = m[1]!;
  t = t.split(/[,;]/)[0]!.trim();
  return t.length > 70 ? `${t.slice(0, 69)}…` : t;
}

/** Turn "Product may be contaminated with Salmonella Senftenberg." into "Salmonella risk". */
export function plainReason(reason: string, summary = ""): string {
  // FSIS files reasons as categories ("Product Contamination"); the pathogen is in the summary.
  const r = `${reason} ${summary}`.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/listeria/, "Listeria contamination risk"],
    [/salmonella/, "Salmonella contamination risk"],
    [/e\.? ?coli/, "E. coli contamination risk"],
    [/norovirus|hepatitis/, "Virus contamination risk"],
    [/undeclared\s+(\w+)/, "Undeclared allergen"],
    [/allergen/, "Undeclared allergen"],
    [/foreign (material|object|matter)|metal|plastic|glass/, "May contain pieces of metal, plastic or glass"],
    [/mold|mould/, "Mold"],
    [/burn/, "Burn hazard"],
    [/lacerat|cut/, "Cut hazard"],
    [/chok/, "Choking hazard"],
    [/fire|overheat/, "Fire hazard"],
    [/lead\b|heavy metal|arsenic|cadmium/, "Heavy metal contamination"],
    [/ndma|nitros|impurity/, "Contains an impurity above safe limits"],
    [/mislabel|misbrand/, "Labeling mistake"],
    [/temperature|refrigerat/, "Was not kept cold enough"],
    [/sanit|hygien|insanitary/, "Made in unsanitary conditions"],
  ];
  for (const [re, label] of rules) {
    const m = r.match(re);
    if (m) {
      if (label === "Undeclared allergen") {
        const a = r.match(/undeclared\s+([a-z ]+?)(?:\s+allergen|[.,;)]|$)/);
        return a?.[1] ? `Contains ${a[1].trim()} that isn't on the label` : label;
      }
      return label;
    }
  }
  const first = (reason || summary).split(/[.;\n]/)[0]?.trim() ?? "";
  return first.length > 90 ? `${first.slice(0, 89)}…` : first || "See details";
}

/** Friendly reason for an alert: lead with what the user is watching. */
export function whyAlert(alert: Pick<Alert, "reason" | "watchItemLabel">): string {
  const what = alert.watchItemLabel ? `your "${alert.watchItemLabel}"` : "something you watch";
  switch (alert.reason) {
    case "upc_exact":
      return `Exact barcode match for ${what}`;
    case "brand_match":
      return `Matches the brand of ${what}`;
    case "scan_text_match":
      return `Matches the label you scanned (${alert.watchItemLabel ?? "scan"})`;
    case "restaurant_supplier":
      return `Affects a supplier of ${alert.watchItemLabel ?? "a restaurant you track"}`;
    case "category_subscription":
      return `In a category you follow (${alert.watchItemLabel ?? "subscription"})`;
    default:
      return `Looks related to ${what}`;
  }
}

export function gradeFriendly(grade: RestaurantGrade | null | undefined): { title: string; body: string; level: RestaurantGrade["level"] } {
  if (!grade || (!grade.grade && grade.score == null)) return { title: "No grade yet", body: "We're checking the health department's records.", level: "unknown" };
  const g = grade.grade ?? String(grade.score);
  switch (grade.level) {
    case "good":
      return { title: `Grade ${g}`, body: "Passed its last inspection with flying colors.", level: "good" };
    case "ok":
      return { title: `Grade ${g}`, body: "Passed, but inspectors found some things to fix.", level: "ok" };
    case "poor":
      return { title: `Grade ${g}`, body: "Serious problems at the last inspection. Maybe skip it for now.", level: "poor" };
    default:
      return { title: `Grade ${g}`, body: "Inspected, but we can't rate this grade scale yet.", level: "unknown" };
  }
}

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Barcodes are stored as GTIN-14; show UPC-A as the familiar 12 digits. */
export function displayBarcode(code: string): string {
  const d = code.replace(/\D/g, "");
  if (d.length === 14 && d.startsWith("00")) return d.slice(2);
  if (d.length === 14 && d.startsWith("0")) return d.slice(1);
  return d;
}
