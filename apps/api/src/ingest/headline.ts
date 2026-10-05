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
  const original = s.split(/\s+/);
  return original
    .map((orig, i) => {
      const w = orig.toLowerCase();
      const core = w.replace(/[^a-z]/g, "");
      if (KEEP_UPPER.has(core)) return w.toUpperCase();
      // A leading 2–3 letter all-caps token is usually a brand acronym ("ABG", "BD"), not a word.
      if (i === 0 && /^[A-Z]{2,3}$/.test(orig) && !COMMON_SHORT.has(core)) return orig;
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
/** "Bard¿ Foley" (a ® mis-decoded upstream), U+FFFD, and trademark marks: drop them. */
export function stripMarkArtifacts(s: string): string {
  return s.replace(/(?<=[\p{L}\p{N}])¿/gu, "").replace(/[\uFFFD®™©]/g, "");
}

const LIST_MARKER = /^\s*(?:\(?\d{1,2}[).]|[-•*])\s+/;
const BOILERPLATE = /^\s*(?:products?|items?|lots?)\s+(?:that|which)\s+contains?\s+(?:the\s+)?/i;
/** Pharmacy and device shorthand that reads as noise in a headline. */
const ABBREVIATIONS: Record<string, string> = { inj: "Injection", soln: "Solution", susp: "Suspension", oint: "Ointment", tab: "Tablet", tabs: "Tablets", cap: "Capsule", caps: "Capsules", sol: "Solution", syr: "Syrup", supp: "Suppository" };
const COMMON_SHORT = new Set(["the", "and", "for", "new", "big", "hot", "red", "all", "one", "two", "kit", "bar", "pie", "egg", "ham", "tea", "oil", "mix", "jar", "can", "box", "bag", "pad", "cup", "pan", "set", "toy"]);

function isCompanyPrefix(prefix: string, company: string): boolean {
  return !company || prefix === company || company.startsWith(prefix) || prefix.startsWith(company.slice(0, 12)) || /\b(inc|llc|lp|co|corp|ltd|company|foods|farms|brands|industries)\b\.?$/.test(prefix);
}

/** Catalog fragments that survive part-number stripping: "id x", "od x id", dangling "c-", single letters, repeats. */
function tidyFragments(s: string): string {
  let t = s.split(/\s\/\s/)[0]!; // "insert / od x id" lists: keep the first item
  t = t.replace(/\b(?:i\.?d|o\.?d)\b\s*(?:x\b\s*)?/gi, " ").replace(/\s\bx\b\s/gi, " ");
  t = t.replace(/\s[\p{L}\p{N}]{1,2}-(?=\s|$)/gu, " "); // "c-"
  const seen = new Set<string>();
  const words = t.split(/\s+/).filter((w) => {
    const k = w.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k.length === 1 && k !== "a" && !/\d/.test(k)) return false; // stray single letters
    if (k.length >= 3 && seen.has(k)) return false; // "acetabular insert … acetabular insert"
    if (k) seen.add(k);
    return true;
  });
  return words.map((w) => ABBREVIATIONS[w.toLowerCase().replace(/\.$/, "")] ?? w).join(" ");
}

export function cleanHeadline(r: HeadlineInput, max = 70): string {
  let t = stripMarkArtifacts(r.title.trim());
  const company = (r.company ?? "").toLowerCase();
  const startedWithList = { value: false };
  t = t.replace(BOILERPLATE, "");
  // "Company Name: product…" (our FDA titles) or "Product family: 1) item, 2) item".
  const colon = t.indexOf(": ");
  if (colon > 0 && colon < 70) {
    const prefix = t.slice(0, colon);
    const rest = t.slice(colon + 2);
    if (isCompanyPrefix(prefix.toLowerCase(), company)) {
      t = rest;
      if (LIST_MARKER.test(t)) startedWithList.value = true;
    } else if (LIST_MARKER.test(rest) || rest.length > 40) {
      t = prefix; // "Medline Convenience Kits: 1) neuro pack, 2) spine pack" → the family name
    }
  }
  t = t.replace(BOILERPLATE, "");
  if (LIST_MARKER.test(t)) startedWithList.value = true;
  t = t.replace(LIST_MARKER, "");
  t = t.replace(/^(public health alert:\s*)/i, "");
  t = t.replace(LABEL_PREFIX, "");
  // Agency headlines: "Acme Foods Recalls Ready-To-Eat Liverwurst Products Due to Possible Listeria".
  const m = t.match(/\b(?:recalls|issues (?:a )?public health alert for|expands recall of)\s+(.+?)(?:\s+(?:due to|because of|for possible|over|that may)\b.*)?$/i);
  if (m) t = m[1]!;
  t = t.replace(CODE_TAIL, "");
  t = t.replace(SIZE_SPEC, " ").replace(PART_NUMBER, " ");
  t = t.replace(PACK_SIZE, " ").replace(RATIO, " ");
  t = t.replace(/\s*\([^)]*\)\s*/g, " "); // parenthetical codes/sizes
  t = t.split(/[,;]|\s\d{1,2}\)\s/)[0]!;
  t = tidyFragments(t);
  t = t.replace(/\s{2,}/g, " ").replace(TRAILING_PUNCT, "").trim();
  if (isShouting(t)) t = sentenceCase(t);
  else t = calmWords(t);
  // Only a list item ("1) neuro") or a scrap under five letters: say whose product it is. A short
  // real name ("Veriqa", "Bardex") stays as it is.
  if (t.length < 5 || startedWithList.value) {
    const fromDescription = r.productDescription ? cleanHeadline({ title: stripMarkArtifacts(r.productDescription), company: r.company, brands: r.brands }, max) : "";
    const companyShort = (r.company ?? "").replace(/[,.]?\s*\b(inc|llc|lp|l\.p|co|corp|corporation|ltd|company|industries)\b\.?/gi, "").trim();
    const base = fromDescription.length >= 8 ? fromDescription : t;
    const needsCompany = companyShort && !base.toLowerCase().includes(companyShort.toLowerCase().split(" ")[0]!);
    t = needsCompany ? `${companyShort} ${base.charAt(0).toLowerCase()}${base.slice(1)}` : base;
  }
  if (!t) t = r.brands?.[0] ?? r.company ?? r.title;
  if (t.length > max) {
    const cut = t.slice(0, max - 1);
    t = `${cut.slice(0, Math.max(20, cut.lastIndexOf(" ")))}…`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Expose for tests/UI. */
export const headlineSmallWords = SMALL;
