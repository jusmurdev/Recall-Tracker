/**
 * Dietary profile helpers for the app: labels, copy, and the small state machine behind the
 * "Diet and allergies" settings card. Pure functions so they can be unit-tested without React.
 */
import { DIET_PROFILE_LABEL, type Alert, type DietHit, type DietPreferences, type DietProfile } from "@recall/shared";

export const ALLERGY_PROFILES: Array<{ profile: DietProfile; label: string; emoji: string }> = [
  { profile: "allergy_milk", label: "Milk", emoji: "🥛" },
  { profile: "allergy_egg", label: "Eggs", emoji: "🥚" },
  { profile: "allergy_fish", label: "Fish", emoji: "🐟" },
  { profile: "allergy_shellfish", label: "Shellfish", emoji: "🦐" },
  { profile: "allergy_tree_nut", label: "Tree nuts", emoji: "🌰" },
  { profile: "allergy_peanut", label: "Peanuts", emoji: "🥜" },
  { profile: "allergy_wheat", label: "Wheat", emoji: "🌾" },
  { profile: "allergy_soy", label: "Soy", emoji: "🫘" },
  { profile: "allergy_sesame", label: "Sesame", emoji: "⚪" },
];

export const DIET_TOGGLES: Array<{ profile: DietProfile; label: string; description: string }> = [
  { profile: "gluten_free", label: "Gluten-free", description: "Wheat, barley, rye, malt and hidden sources like semolina or brewer's yeast." },
  { profile: "halal", label: "Halal diet", description: "Flags haram ingredients named in a recall or on a label: pork and pork derivatives, alcohol, non-halal gelatin, carmine." },
  { profile: "kosher", label: "Kosher", description: "Flags pork, shellfish, meat-and-dairy mixing, and recalls of kosher-certified products." },
];

export const EMPTY_DIET: DietPreferences = { dietProfiles: [], otherAllergens: [] };

export function hasDiet(d: Partial<DietPreferences> | null | undefined): boolean {
  return !!d && ((d.dietProfiles?.length ?? 0) > 0 || (d.otherAllergens?.length ?? 0) > 0);
}

export function toggleProfile(d: DietPreferences, profile: DietProfile): DietPreferences {
  const on = d.dietProfiles.includes(profile);
  return { ...d, dietProfiles: on ? d.dietProfiles.filter((p) => p !== profile) : [...d.dietProfiles, profile] };
}

/** Normalize a typed allergen: trimmed, lower-case, letters/spaces/hyphens/apostrophes only, 2–40 chars. */
export function normalizeAllergen(input: string): string | null {
  const v = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > 40 || !/^[\p{L}' -]+$/u.test(v)) return null;
  return v;
}

export function addOtherAllergen(d: DietPreferences, input: string): { next: DietPreferences; error: string | null } {
  const v = normalizeAllergen(input);
  if (!v) return { next: d, error: "Use letters only, 2 to 40 characters." };
  if (d.otherAllergens.includes(v)) return { next: d, error: null };
  if (d.otherAllergens.length >= 10) return { next: d, error: "You can add up to 10 allergens." };
  // Already covered by a built-in allergy? Suggest the toggle instead of duplicating.
  const builtIn = ALLERGY_PROFILES.find((a) => a.label.toLowerCase() === v || a.label.toLowerCase().replace(/s$/, "") === v.replace(/s$/, ""));
  if (builtIn) return { next: d.dietProfiles.includes(builtIn.profile) ? d : { ...d, dietProfiles: [...d.dietProfiles, builtIn.profile] }, error: null };
  return { next: { ...d, otherAllergens: [...d.otherAllergens, v] }, error: null };
}

export function removeOtherAllergen(d: DietPreferences, word: string): DietPreferences {
  return { ...d, otherAllergens: d.otherAllergens.filter((a) => a !== word) };
}

export function profileLabel(profile: string | null | undefined, hit?: Pick<DietHit, "label"> | null): string {
  if (hit?.label) return hit.label;
  if (!profile) return "your diet";
  return DIET_PROFILE_LABEL[profile as DietProfile] ?? profile;
}

/** "You listed peanut allergy" → "peanut allergy"; "Halal diet" → "halal diet". */
export function profilePhrase(profile: string | null | undefined, explanation?: string): string {
  if (profile === "allergy_other") {
    const m = explanation?.match(/You listed ([a-z' -]+ allergy)/i);
    return m ? m[1]!.toLowerCase() : "your allergy";
  }
  const l = profileLabel(profile);
  if (l === "Kosher") return "kosher diet";
  if (l === "Gluten-free") return "gluten-free diet";
  return l.charAt(0).toLowerCase() + l.slice(1);
}

/** Home lead line when diet alerts are open: "1 recall matches your peanut allergy". */
export function dietHeadline(alerts: Array<Pick<Alert, "reason" | "dietProfile" | "explanation" | "resolvedAt" | "dismissedAt">>): string | null {
  const open = alerts.filter((a) => a.reason === "diet_match" && !a.resolvedAt && !a.dismissedAt);
  if (!open.length) return null;
  const phrases = [...new Set(open.map((a) => profilePhrase(a.dietProfile, a.explanation)))];
  const what = phrases.length === 1 ? `your ${phrases[0]}` : phrases.length === 2 ? `your ${phrases[0]} and ${phrases[1]}` : "your diet profile";
  return `${open.length} recall${open.length === 1 ? "" : "s"} match${open.length === 1 ? "es" : ""} ${what}`;
}

/** Split text into plain and highlighted segments around the matched phrase (case-insensitive). */
export function highlightSegments(text: string, phrase: string | null | undefined): Array<{ text: string; hit: boolean }> {
  if (!text) return [];
  if (!phrase) return [{ text, hit: false }];
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return [{ text, hit: false }];
  const out: Array<{ text: string; hit: boolean }> = [];
  if (idx > 0) out.push({ text: text.slice(0, idx), hit: false });
  out.push({ text: text.slice(idx, idx + phrase.length), hit: true });
  if (idx + phrase.length < text.length) out.push({ text: text.slice(idx + phrase.length), hit: false });
  return out;
}

/** A short excerpt of a long field around the matched phrase, for the alert detail card. */
export function excerptAround(text: string, phrase: string | null | undefined, radius = 90): string {
  if (!text) return "";
  if (!phrase) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const idx = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + phrase.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export const DIET_KIND_LABEL: Record<DietHit["kind"], string> = {
  undeclared: "Undeclared",
  mention: "Mentioned",
  certification: "Kosher-certified product",
  cross_contact: "Meat and dairy",
  ambiguous: "Might contain",
};
