/**
 * Deterministic headline cleaner. Sources shout: "SYSCO BLEND LETT/ROM 50/50 NOCLR 4/5# …",
 * "J.M. Smucker Co.: Jif Creamy Peanut Butter, 16 oz, UPC 0 51500 24128 1". This turns a title
 * into something a person would say, without inventing anything: strip the "COMPANY:" prefix,
 * sentence-case all-caps text, drop pack sizes and codes, cut at the first clause.
 * Used whenever no better (AI-written) headline exists.
 */

/** Tokens kept upper-case even when the rest is sentence-cased. */
const KEEP_UPPER = new Set(["usda", "fda", "cpsc", "upc", "rte", "bbq", "usa", "uk", "ii", "iii", "iv", "xl", "xxl", "tv", "led", "lcd", "usb", "hd", "iq", "dvd", "atv", "utv", "suv", "rv", "ac", "dc", "diy", "bpa"]);
/** Words that read fine in lower case inside a title. */
const SMALL = new Set(["a", "an", "and", "or", "of", "the", "in", "on", "for", "with", "to", "by", "at", "from", "w"]);

/** Label prefixes catalog-style titles carry: "Brand Name: VERIQA", "REF: 1234", "Catalog No. 55". */
const LABEL_PREFIX = /^\s*(brand name|brand|product name|product|trade name|device name|model name|catalog(?:ue)? (?:no|number|#)\.?|ref\.?|item(?: no| number)?)\s*[:#]\s*/i;
/** Part and catalog numbers: letters and digits mixed, with digits ("DYNJ59097A", "5612-P-411", "REF 1234-56"). */
const PART_NUMBER = /\b(?:ref|cat(?:alog)?(?:\s*no)?\.?|model|p\/n|part(?: no)?\.?|sku|item(?: no)?\.?|lot)\s*[:#]?\s*[A-Za-z0-9][A-Za-z0-9./-]*\d[A-Za-z0-9./-]*|\b(?=[A-Za-z0-9./-]*\d)(?=[A-Za-z0-9./-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9./-]{3,}\b|\b\d{5,}[A-Za-z0-9-]*\b/gi;
const SIZE_SPEC = /\b(?:size|sz)\s*[:#]?\s*\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:mm|cm|mg|mcg|ml|fr|ga|gauge|in|inch)\b\.?/gi;
const PACK_SIZE = /\b\d+(\.\d+)?\s*(\/\s*\d+(\.\d+)?)?\s*(?:#|(?:lb|lbs|oz|fl ?oz|ml|l|g|kg|ct|cnt|count|pk|pack|ea|each|gal|qt|pt|dz|dozen|z)\b\.?)/gi;
const RATIO = /\b\d+\/\d+\b/g; // 50/50, 4/5
const CODE_TAIL = /\s*[,;(]?\s*(upc|lot|lots|item|sku|model|code|codes|case|best by|use by|sell by|exp|expires|batch)\b.*$/i;
const TRAILING_PUNCT = /[\s,;:\-–—/]+$/;

export function isShouting(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length > 0.85;
}

/** "SYSCO BLEND LETT/ROM" → "Sysco blend lett/rom"; keeps known acronyms and numbers as they are. */
export function sentenceCase(s: string): string {
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => {
      const core = w.replace(/[^a-z]/g, "");
      if (KEEP_UPPER.has(core)) return w.toUpperCase();
      if (i === 0) return w.charAt(0).toUpperCase() + w.slice(1);
      return w;
    })
    .join(" ");
}

/** "Haylard BASIC BIOPSY TRAY" → "Haylard basic biopsy tray": lower-case shouting words inside an otherwise normal title. */
export function calmWords(s: string): string {
  return s
    .split(/(\s+)/)
    .map((w) => {
      const letters = w.replace(/[^A-Za-z]/g, "");
      if (letters.length >= 4 && letters === letters.toUpperCase() && !KEEP_UPPER.has(letters.toLowerCase())) return w.toLowerCase();
      return w;
    })
    .join("");
}

export interface HeadlineInput {
  title: string;
  company?: string | null;
  productDescription?: string | null;
  brands?: string[];
}

/** Short cleaned product name for a list row. Never longer than `max` characters. */
export function cleanHeadline(r: HeadlineInput, max = 70): string {
  let t = r.title.trim();
  // "Company Name: product…" (our FDA titles) or any "SOMETHING CO:" prefix.
  const colon = t.indexOf(": ");
  if (colon > 0 && colon < 70) {
    const prefix = t.slice(0, colon).toLowerCase();
    const company = (r.company ?? "").toLowerCase();
    if (!company || prefix === company || company.startsWith(prefix) || prefix.startsWith(company.slice(0, 12)) || /\b(inc|llc|co|corp|ltd|company|foods|farms|brands)\b\.?$/.test(prefix)) t = t.slice(colon + 2);
  }
  t = t.replace(/^(public health alert:\s*)/i, "");
  t = t.replace(LABEL_PREFIX, "");
  // Agency headlines: "Acme Foods Recalls Ready-To-Eat Liverwurst Products Due to Possible Listeria".
  const m = t.match(/\b(?:recalls|issues (?:a )?public health alert for|expands recall of)\s+(.+?)(?:\s+(?:due to|because of|for possible|over|that may)\b.*)?$/i);
  if (m) t = m[1]!;
  t = t.replace(CODE_TAIL, "");
  t = t.replace(SIZE_SPEC, " ").replace(PART_NUMBER, " ");
  t = t.replace(PACK_SIZE, " ").replace(RATIO, " ");
  t = t.replace(/\s*\([^)]*\)\s*/g, " "); // parenthetical codes/sizes
  t = t.split(/[,;]/)[0]!;
  t = t.replace(/\s{2,}/g, " ").replace(TRAILING_PUNCT, "").trim();
  if (isShouting(t)) t = sentenceCase(t);
  else t = calmWords(t);
  if (!t) t = r.brands?.[0] ?? r.company ?? r.title;
  if (t.length > max) {
    const cut = t.slice(0, max - 1);
    t = `${cut.slice(0, Math.max(20, cut.lastIndexOf(" ")))}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Expose for tests/UI. */
export const headlineSmallWords = SMALL;
