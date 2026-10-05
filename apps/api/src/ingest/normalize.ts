import { createHash } from "node:crypto";
import { US_STATES } from "@recall/shared";
import { normalizeGtin } from "../scan/gtin.js";
import type { NormalizedRecall } from "./types.js";

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  "washington dc": "DC", "washington, dc": "DC", "puerto rico": "PR",
};

const STATE_CODES = new Set<string>(US_STATES);

/**
 * Turn a free-text distribution pattern ("Nationwide", "CA, NV and AZ",
 * "Distributed in Texas and Oklahoma") into a list of state codes. Returns ["US"]
 * for nationwide distribution; empty when nothing recognisable was found.
 */
export function parseDistributionStates(text: string | null | undefined): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  if (/nationwide|national distribution|throughout the (united states|us|u\.s\.)|all 50 states|all states|across the (united states|us|u\.s\.)/.test(lower)) {
    return ["US"];
  }
  const found = new Set<string>();
  // Full names first (longest names first so "west virginia" wins over "virginia").
  const names = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);
  let remaining = lower;
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    if (re.test(remaining)) {
      found.add(STATE_NAMES[name]!);
      remaining = remaining.replace(re, " ");
    }
  }
  // Then upper-case two-letter codes in the original text (avoid matching ordinary words).
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) {
    const code = m[1]!;
    if (STATE_CODES.has(code) && code !== "IN" && code !== "OR" && code !== "ME" && code !== "OK" && code !== "HI" && code !== "ID" && code !== "DE") {
      found.add(code);
    } else if (STATE_CODES.has(code) && /,|\band\b|&/.test(text.slice(Math.max(0, m.index! - 6), m.index! + 6))) {
      // Ambiguous codes (IN, OR, ME...) only count when they appear in a comma/and list.
      found.add(code);
    }
  }
  return [...found].sort();
}

/**
 * Extract UPC/EAN codes from label text. Handles "UPC 0 41130 32130 9", "UPC: 041130321309",
 * "UPC Code 4-11303-21309", and bare 12–14 digit runs. Returns de-duplicated 8–14 digit strings.
 */
export function extractUpcs(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  // Explicit "UPC ..." mentions: capture digit groups separated by spaces/dashes.
  for (const m of text.matchAll(/UPC(?:\s*code|\s*#|\s*codes?|\s*number)?s?\s*[:#]?\s*((?:\d[\d\s-]{6,}\d))/gi)) {
    const digits = m[1]!.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) out.add(digits);
    // Lists like "UPC 012345678905, 012345678912"
    for (const extra of m[1]!.split(/[,;]/)) {
      const d = extra.replace(/\D/g, "");
      if (d.length >= 8 && d.length <= 14) out.add(d);
    }
  }
  // Bare 12–14 digit numbers (GTIN-12/13/14) not glued to other digits.
  for (const m of text.matchAll(/(?<!\d)(\d{12,14})(?!\d)/g)) out.add(m[1]!);
  // Stored as GTIN-14 so UPC-A and its EAN-13 form compare equal.
  return [...new Set([...out].map(normalizeGtin))];
}

/** Collapse whitespace and strip HTML tags from source text. */
export function cleanText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    // openFDA serves "®" as "¿" in some device records ("Bard¿ Foley"); drop it and U+FFFD.
    .replace(/(?<=[\p{L}\p{N}])¿/gu, "")
    .replace(/\uFFFD/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Parse openFDA's YYYYMMDD dates. */
export function parseCompactDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{8}$/.test(s)) return null;
  const d = new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8))));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseLooseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d;
  // "Sep 30, 2026" or "September 30, 2026"
  const m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const d2 = new Date(`${m[1]} ${m[2]}, ${m[3]} UTC`);
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  return null;
}

export function toYyyymmdd(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pull likely brand names out of product text. Looks for "Brand X", quoted names, and
 * "X brand" patterns. Heuristic by design; matching also runs on full text.
 */
export function extractBrands(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const add = (b: string | undefined) => {
    const v = (b ?? "").replace(/[®™©]/g, "").replace(/\s+/g, " ").trim().replace(/[,.;:]+$/, "");
    if (v.length >= 2 && v.length <= 60 && !BRAND_STOP.test(v)) out.add(v);
  };
  for (const m of text.matchAll(/["“]([^"”]{2,60})["”]/g)) add(m[1]);
  for (const m of text.matchAll(/\b([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})\s+[Bb]rand\b/g)) add(m[1]);
  for (const m of text.matchAll(/\b[Bb]rand(?:\s+name)?s?:?\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/g)) add(m[1]);
  // "Jif® Creamy…", "KIRKLAND SIGNATURE™": a trademark symbol marks the brand.
  for (const m of text.matchAll(/\b([A-Za-z][\w&'’.-]*(?:\s+[A-Za-z][\w&'’.-]*){0,2})\s?[®™]/g)) add(m[1]);
  // "sold under the Great Value label", "marketed as Nature's Promise", "labeled as X".
  for (const m of text.matchAll(/\b(?:under the|marketed as|labeled as|labelled as|sold as|branded as)\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})(?:\s+(?:brand|label|name))?/g)) add(m[1]);
  // Leading proper-noun run before the first generic product word: "Prairie Paws Freeze-Dried…" → "Prairie Paws".
  const lead = text.trimStart().match(/^([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,2})\s+(?=[A-Z][a-z]|[a-z])/);
  if (lead && !/^(the|a|an|recall|recalled|product|products|all|various|certain)\b/i.test(lead[1]!) && !/\b(inc|llc|co|corp|ltd)\b\.?$/i.test(lead[1]!)) {
    // Keep only the words before an obviously generic one ("Jif Creamy" → "Jif").
    const words = lead[1]!.split(/\s+/);
    const cut = words.findIndex((w) => GENERIC_LEAD.has(w.toLowerCase().replace(/[^a-z]/g, "")));
    add((cut === -1 ? words : words.slice(0, cut)).join(" "));
  }
  return [...out];
}

const BRAND_STOP = /^(the|and|lot|lots|upc|best by|use by|sell by|exp|item|model|net wt|all|various|certain|product|products|recall|recalled|see|note|dist|distributed|manufactured|packed|produced|ingredients|contains|may contain)$/i;
const GENERIC_LEAD = new Set(["cold", "coldpressed", "pressed", "readytoeat", "readyto", "creamy", "crunchy", "organic", "natural", "fresh", "frozen", "whole", "raw", "freeze", "freezedried", "dried", "ready", "sliced", "smoked", "roasted", "premium", "original", "classic", "chicken", "beef", "pork", "turkey", "dog", "cat", "pet", "baby", "infant", "ground", "deli", "cold", "hot", "sweet", "spicy", "mild", "light", "dark", "white", "brown", "green", "red", "blue", "black", "golden", "mixed", "assorted", "select", "family", "value"]);

/**
 * Pull the "what consumers should do" guidance out of recall prose. Agencies phrase it
 * consistently ("Consumers who have purchased … are urged to return it to the place of
 * purchase for a full refund", "should not consume", "throw away", "contact the company at…").
 */
export function extractRemedy(text: string | null | undefined): string | null {
  if (!text) return null;
  const sentences = cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z"“])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
  const cues = /\b(should (not|be)|are urged|is urged|urged to|advised to|should (return|discard|throw|dispose|stop|contact|immediately|not)|do not (consume|eat|use)|throw (it )?away|discard|return (it|them|the product|to the (place|store))|full refund|refund|contact (the )?(company|firm|customer)|destroy|stop using)\b/i;
  const picked: string[] = [];
  for (const s of sentences) {
    if (cues.test(s) && !/^(the )?(fda|fsis|cpsc) (has|have) not/i.test(s)) picked.push(s);
    if (picked.join(" ").length > 500) break;
  }
  return picked.length ? truncate(picked.join(" "), 600) : null;
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Stable hash of the fields that matter, so re-ingesting unchanged data is a no-op. */
export function contentHash(r: NormalizedRecall): string {
  const payload = JSON.stringify({
    title: r.title,
    summary: r.summary,
    productDescription: r.productDescription,
    reason: r.reason,
    category: r.category,
    severity: r.severity,
    status: r.status,
    company: r.company,
    brands: [...r.brands].sort(),
    upcs: [...r.upcs].sort(),
    distributionStates: [...r.distributionStates].sort(),
    recallDate: r.recallDate?.toISOString() ?? null,
    url: r.url,
    imageUrls: r.imageUrls,
    codeInfo: r.codeInfo,
    remedy: r.remedy,
  });
  return createHash("sha256").update(payload).digest("hex");
}
