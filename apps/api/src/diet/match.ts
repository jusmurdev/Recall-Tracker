/**
 * Deterministic matcher over the dietary dictionary. Works on recall notices (several fields)
 * and on label/receipt text. No AI, no network: the free tier runs this on every recall.
 */
import { DIET_PROFILE_LABEL, type DietHit, type DietProfile } from "@recall/shared";
import { ENTRIES, KOSHER_CERTIFIERS, MEAT_DAIRY_CUES, NEGATION_CUES, UNDECLARED_CUES, isAllergyProfile, isAvoidanceProfile, type DictionaryEntry } from "./dictionary.js";

export type DietHitKind = DietHit["kind"];

export interface DietSelection {
  dietProfiles: readonly string[];
  otherAllergens: readonly string[];
}

export interface RecallFields {
  title: string;
  summary: string;
  productDescription: string;
  reason: string;
  codeInfo?: string | null;
}

/** Fields in the order a hit's importance is judged: the reason explains why it was recalled. */
const FIELD_ORDER: Array<keyof RecallFields> = ["reason", "summary", "title", "productDescription", "codeInfo"];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One regex per term: word boundaries, simple plurals, spaces or hyphens between words. */
export function termRegex(term: string): RegExp {
  const words = term.toLowerCase().trim().split(/[\s-]+/).filter(Boolean);
  const body = words
    .map((w, i) => {
      const last = i === words.length - 1;
      let core = escape(w);
      if (last && !/\d$/.test(w)) {
        if (w.endsWith("y") && w.length > 3) core = `${escape(w.slice(0, -1))}(?:y|ies)`;
        else if (/(s|x|z|ch|sh)$/.test(w)) core = `${core}(?:es)?`;
        else core = `${core}(?:s|es)?`;
      }
      return core;
    })
    .join("[\\s-]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

const cache = new Map<string, RegExp>();
function re(term: string): RegExp {
  let r = cache.get(term);
  if (!r) {
    r = termRegex(term);
    cache.set(term, r);
  }
  r.lastIndex = 0;
  return r;
}

// Phrase cues may sit a few words back ("free from gluten and wheat"); the short cues "no", "non"
// and "zero" must touch the term, or "nonfat dry milk" would read as "no milk".
const PHRASE_CUES = NEGATION_CUES.filter((c) => !["no ", "non", "zero"].includes(c));
const NEGATION_PHRASE_RE = new RegExp(`(?:${PHRASE_CUES.map((c) => escape(c.trim())).join("|")})\\b[^.;:()]{0,32}$`, "i");
const NEGATION_ADJACENT_RE = /(?:^|[\s(,;:-])(?:no|non|zero)[\s-]*(?:added\s+|any\s+|artificial\s+)?$/i;
const isNegated = (before: string) => NEGATION_PHRASE_RE.test(before) || NEGATION_ADJACENT_RE.test(before);
const UNDECLARED_BEFORE_RE = new RegExp(`(?:${UNDECLARED_CUES.map(escape).join("|")})[^.;]{0,60}$`, "i");
const UNDECLARED_AFTER_RE = new RegExp(`^[^.;]{0,50}?(?:${UNDECLARED_CUES.filter((c) => !c.startsWith("may") && !c.startsWith("could") && !c.startsWith("presence") && !c.startsWith("traces") && !c.startsWith("trace")).map(escape).join("|")})`, "i");
const FREE_AFTER_RE = /^[\s-]*free\b/i;

export interface RawHit {
  profile: DietProfile | "allergy_other";
  term: string;
  phrase: string;
  index: number;
  kind: DietHitKind;
  field: string;
}

/** Scan one piece of text for one dictionary entry (or a free-text allergen). */
export function scanText(text: string, entry: Pick<DictionaryEntry, "profile" | "terms" | "ambiguous">, field = "text"): RawHit[] {
  const hits: RawHit[] = [];
  if (!text) return hits;
  const lower = text.toLowerCase();
  const consider = (term: string, ambiguous: boolean) => {
    const r = re(term);
    let m: RegExpExecArray | null;
    while ((m = r.exec(lower))) {
      const start = m.index;
      const end = start + m[0].length;
      const before = lower.slice(Math.max(0, start - 70), start);
      const after = lower.slice(end, end + 60);
      // "dairy-free" is a label claim about the term itself; never a hit (the undeclared allergen,
      // if any, is named separately: "labeled dairy-free ... contains undeclared milk").
      if (FREE_AFTER_RE.test(after)) continue;
      const undeclared = UNDECLARED_BEFORE_RE.test(before) || UNDECLARED_AFTER_RE.test(after);
      // "contains no milk", "free from gluten": not a hit, unless the sentence is literally about an
      // undeclared allergen.
      if (!undeclared && isNegated(before.slice(-48))) continue;
      // An ambiguous word stays ambiguous even next to "undeclared": "undeclared almonds (tree
      // nuts)" is not a peanut hit just because "nuts" is on the peanut maybe-list.
      hits.push({ profile: entry.profile, term, phrase: text.slice(start, end), index: start, kind: ambiguous ? "ambiguous" : undeclared ? "undeclared" : "mention", field });
    }
  };
  for (const t of entry.terms) consider(t, false);
  for (const t of entry.ambiguous ?? []) consider(t, true);
  // Keep one hit per term (first occurrence), undeclared preferred.
  const byTerm = new Map<string, RawHit>();
  for (const h of hits) {
    const prev = byTerm.get(h.term);
    if (!prev || (h.kind === "undeclared" && prev.kind !== "undeclared")) byTerm.set(h.term, h);
  }
  // Overlapping terms at the same spot ("natural flavor" inside "natural flavors"): keep the longest.
  const byIndex = new Map<number, RawHit>();
  for (const h of byTerm.values()) {
    const prev = byIndex.get(h.index);
    if (!prev || h.phrase.length > prev.phrase.length) byIndex.set(h.index, h);
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

/** Dictionary entries for the user's selection, including free-text allergens. */
export function entriesFor(sel: DietSelection): Array<Pick<DictionaryEntry, "profile" | "terms" | "ambiguous"> & { label: string; noun: string }> {
  const out: Array<Pick<DictionaryEntry, "profile" | "terms" | "ambiguous"> & { label: string; noun: string }> = [];
  for (const e of ENTRIES) if (sel.dietProfiles.includes(e.profile)) out.push({ ...e, label: DIET_PROFILE_LABEL[e.profile] });
  for (const raw of sel.otherAllergens) {
    const word = raw.trim().toLowerCase();
    if (word.length < 2) continue;
    out.push({ profile: "allergy_other" as DietProfile, terms: [word], label: `${capitalize(word)} allergy`, noun: word });
  }
  return out;
}

export function labelFor(profile: string, otherAllergens: readonly string[] = [], term?: string): string {
  if (profile === "allergy_other") {
    const word = otherAllergens.find((a) => a.toLowerCase() === (term ?? "").toLowerCase()) ?? term ?? "allergen";
    return `${capitalize(word)} allergy`;
  }
  return DIET_PROFILE_LABEL[profile as DietProfile] ?? profile;
}

/** Honest, plain wording. Never claims certification. */
export function explain(profile: string, kind: DietHitKind, phrase: string, label: string, noun: string): string {
  const p = phrase.toLowerCase();
  if (profile === "halal") {
    if (kind === "ambiguous") return `Mentions ${p}, which can come from animal or alcohol sources. You follow a halal diet; check the label or ask the maker.`;
    return `Mentions ${p}. You follow a halal diet.`;
  }
  if (profile === "kosher") {
    if (kind === "certification") return `This recall names a kosher-certified product (${phrase}). You keep kosher.`;
    if (kind === "cross_contact") return `The notice describes meat and dairy mixing (${p}). You keep kosher.`;
    if (kind === "ambiguous") return `Mentions ${p}, whose source is not stated. You keep kosher; check with the certifier.`;
    return `Mentions ${p}. You keep kosher.`;
  }
  if (profile === "vegan") {
    if (kind === "undeclared") return `Undeclared ${p}, an animal-derived ingredient. You eat vegan.`;
    if (kind === "ambiguous") return `Mentions ${p}, which can be animal- or plant-derived. You eat vegan; check the label or ask the maker.`;
    return `Mentions ${p}, an animal-derived ingredient. You eat vegan.`;
  }
  if (profile === "gluten_free") {
    if (kind === "undeclared") return `Undeclared ${p}, a source of gluten. You avoid gluten.`;
    if (kind === "ambiguous") return `Mentions ${p}, which may contain gluten. You avoid gluten; check the package.`;
    return `Contains ${p}, a source of gluten. You avoid gluten.`;
  }
  // Allergies
  const you = `You listed ${label.toLowerCase()}.`;
  if (kind === "undeclared") return `Undeclared ${p}. ${you} Check the package before eating.`;
  if (kind === "ambiguous") return `Mentions ${p}, which sometimes contains ${noun}. ${you} Check the package.`;
  if (p === noun || p === `${noun}s`) return `Mentions ${p}. ${you}`;
  return `Mentions ${p} (a form of ${noun}). ${you}`;
}

export interface RecallDietHit extends DietHit {
  /** Suggested alert score (0..1). */
  score: number;
  /** Severity floor: undeclared allergens are at least "high". */
  minSeverity: "high" | null;
}

/**
 * Evaluate one recall against one user's selection. Returns the single strongest hit (what the
 * alert is about) plus every hit for display. Allergens named only in the product itself
 * ("Peanut Butter Cups" recalled for metal) are not alerts: nothing is hidden there.
 */
export function matchRecallForDiet(recall: RecallFields, sel: DietSelection): { best: RecallDietHit | null; all: RecallDietHit[] } {
  const entries = entriesFor(sel);
  if (!entries.length) return { best: null, all: [] };
  const reasonText = `${recall.reason} ${recall.summary}`.toLowerCase();
  const allergenRecall = /\b(allergen|allergy|undeclared|mislabel\w*|label(?:ing|ed)? (?:error|mistake|issue)|wrong label|incorrect label)\b/.test(reasonText);
  const all: RecallDietHit[] = [];

  for (const entry of entries) {
    const hits: RawHit[] = [];
    for (const field of FIELD_ORDER) {
      const text = recall[field] ?? "";
      if (!text) continue;
      hits.push(...scanText(text, entry, field));
    }
    if (entry.profile === "kosher") {
      for (const field of FIELD_ORDER) {
        const text = recall[field] ?? "";
        if (!text) continue;
        for (const c of KOSHER_CERTIFIERS) {
          const r = re(c);
          const m = r.exec(text.toLowerCase());
          if (m) hits.push({ profile: "kosher", term: c, phrase: text.slice(m.index, m.index + m[0].length), index: m.index, kind: "certification", field });
        }
        for (const c of MEAT_DAIRY_CUES) {
          const r = re(c);
          const m = r.exec(text.toLowerCase());
          if (m) hits.push({ profile: "kosher", term: c, phrase: text.slice(m.index, m.index + m[0].length), index: m.index, kind: "cross_contact", field });
        }
      }
    }
    for (const h of hits) {
      const inReason = h.field === "reason" || h.field === "summary";
      const allergy = isAllergyProfile(entry.profile);
      let score: number;
      let minSeverity: "high" | null = null;
      if (h.kind === "undeclared") {
        score = allergy ? 0.95 : 0.85;
        if (allergy) minSeverity = "high";
      } else if (h.kind === "certification" || h.kind === "cross_contact") {
        score = 0.7;
      } else if (h.kind === "ambiguous") {
        score = inReason ? 0.4 : 0.3;
      } else if (inReason) {
        score = allergy ? 0.8 : 0.75;
      } else if (isAvoidanceProfile(entry.profile)) {
        // Named in the product, not the reason. Only matters when the recall is about labeling.
        if (!allergenRecall) continue;
        score = 0.6;
      } else {
        score = 0.5;
      }
      all.push({
        profile: h.profile,
        label: entry.label,
        kind: h.kind,
        term: h.term,
        phrase: h.phrase,
        field: h.field,
        explanation: explain(entry.profile, h.kind, h.phrase, entry.label, entry.noun),
        score,
        minSeverity,
      });
    }
  }
  all.sort((a, b) => b.score - a.score || FIELD_ORDER.indexOf(a.field as keyof RecallFields) - FIELD_ORDER.indexOf(b.field as keyof RecallFields));
  const best = all.find((h) => h.kind !== "ambiguous") ?? null;
  return { best, all };
}

/**
 * Label / receipt text: everything that mentions the user's profile, recall or not. "Heads up for
 * your diet" on the scan screen. Ambiguous terms are included and flagged as such.
 */
export function dietHitsForLabel(text: string, sel: DietSelection, field = "label"): DietHit[] {
  const out: DietHit[] = [];
  for (const entry of entriesFor(sel)) {
    for (const h of scanText(text, entry, field)) {
      // "Natural flavors" is on almost every label; as a maybe-allergen it would flag everything.
      // Halal, kosher and vegan users do want to know about unspecified gelatin, flavors and enzymes.
      if (h.kind === "ambiguous" && isAllergyProfile(entry.profile)) continue;
      out.push({ profile: h.profile, label: entry.label, kind: h.kind, term: h.term, phrase: h.phrase, field, explanation: explain(entry.profile, h.kind, h.phrase, entry.label, entry.noun) });
    }
  }
  // One line per profile: the most serious hit, certain before ambiguous.
  const rank = (k: DietHitKind) => (k === "undeclared" ? 0 : k === "mention" ? 1 : k === "certification" || k === "cross_contact" ? 2 : 3);
  const byProfile = new Map<string, DietHit>();
  for (const h of out) {
    const key = h.profile === "allergy_other" ? `${h.profile}:${h.term}` : h.profile;
    const prev = byProfile.get(key);
    if (!prev || rank(h.kind) < rank(prev.kind)) byProfile.set(key, h);
  }
  return [...byProfile.values()];
}

export function hasDietSelection(sel: Partial<DietSelection> | null | undefined): sel is DietSelection {
  return !!sel && ((sel.dietProfiles?.length ?? 0) > 0 || (sel.otherAllergens?.length ?? 0) > 0);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
