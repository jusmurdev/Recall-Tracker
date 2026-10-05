/**
 * Receipt parsing. Receipts are the fastest way to know what someone actually has at home,
 * but they are written in cashier shorthand ("KRGR CRMY PNT BTR 16Z   3.49 F"). This module
 * turns OCR text into product lines with plain-English terms the matcher can use. It is
 * deterministic so the free tier works offline; premium can ask Claude to decode the rest.
 */

import { productTerms } from "./terms.js";

export interface ReceiptLine {
  /** Text as printed. */
  raw: string;
  /** Expanded, lower-cased description ("kroger creamy peanut butter 16 oz"). */
  product: string;
  /** Brand guess (store brand or a recognised brand), lower-cased. */
  brand: string | null;
  /** Search terms for the matcher. */
  terms: string[];
  price: number | null;
  quantity: number;
}

export interface ParsedReceipt {
  store: string | null;
  date: string | null;
  items: ReceiptLine[];
  /** Lines we skipped (totals, payment, coupons) for transparency/debugging. */
  skipped: number;
}

const STORES: Array<[RegExp, string]> = [
  [/\bkroger\b|\bkrgr\b/i, "Kroger"], [/\bwal-?mart\b|\bwm supercenter\b/i, "Walmart"], [/\btarget\b/i, "Target"], [/\bcostco\b/i, "Costco"],
  [/\bsafeway\b/i, "Safeway"], [/\bwhole foods\b|\bwfm\b/i, "Whole Foods"], [/\btrader joe/i, "Trader Joe's"], [/\bpublix\b/i, "Publix"],
  [/\bh-?e-?b\b/i, "H-E-B"], [/\baldi\b/i, "Aldi"], [/\bwegmans\b/i, "Wegmans"], [/\bcvs\b/i, "CVS"], [/\bwalgreens\b/i, "Walgreens"],
  [/\balbertsons\b/i, "Albertsons"], [/\bmeijer\b/i, "Meijer"], [/\bsam'?s club\b/i, "Sam's Club"], [/\bsprouts\b/i, "Sprouts"],
  [/\bfood lion\b/i, "Food Lion"], [/\bgiant\b/i, "Giant"], [/\bstop ?& ?shop\b/i, "Stop & Shop"], [/\bwinco\b/i, "WinCo"], [/\bfred meyer\b/i, "Fred Meyer"],
  [/\bralphs\b/i, "Ralphs"], [/\bvons\b/i, "Vons"], [/\bharris teeter\b/i, "Harris Teeter"], [/\bshoprite\b/i, "ShopRite"], [/\bdollar general\b/i, "Dollar General"],
  [/\bamazon\b/i, "Amazon"], [/\binstacart\b/i, "Instacart"], [/\bpetsmart\b/i, "PetSmart"], [/\bpetco\b/i, "Petco"],
];

/** Store-brand tokens → the brand people know. */
const STORE_BRANDS: Record<string, string> = {
  krgr: "kroger", kro: "kroger", gv: "great value", "great value": "great value", mm: "market pantry", "good & gather": "good & gather", gg: "good & gather",
  ks: "kirkland", kirkland: "kirkland", "365": "365 whole foods", tj: "trader joe's", "trader joes": "trader joe's", publix: "publix", heb: "h-e-b",
  sig: "signature select", "signature": "signature select", "o organics": "o organics", "simple truth": "simple truth", st: "simple truth", meijer: "meijer",
  "members mark": "member's mark", mm2: "member's mark",
};

/** Known brands that show up abbreviated on receipts. */
const BRANDS = ["jif", "skippy", "peter pan", "boars head", "boar's head", "oscar mayer", "hormel", "tyson", "perdue", "kraft", "heinz", "hunts", "campbells", "progresso", "cheerios", "kelloggs", "quaker", "nestle", "gerber", "similac", "enfamil", "pampers", "huggies", "purina", "blue buffalo", "iams", "pedigree", "friskies", "stanley", "yeti", "dole", "chiquita", "tropicana", "minute maid", "simply", "silk", "oatly", "chobani", "yoplait", "dannon", "sargento", "tillamook", "land o lakes", "philadelphia", "ben & jerrys", "haagen dazs", "blue bell", "pepperidge", "nabisco", "oreo", "ritz", "lays", "doritos", "tostitos", "pringles", "coca cola", "coke", "pepsi", "gatorade", "starbucks", "folgers", "maxwell house", "lipton", "arizona", "red bull", "monster", "sunny valley", "prairie paws", "golden wok", "hill country", "northstar", "ranch hand"];

/** Receipt abbreviations → words. Order matters (longer keys first at runtime). */
const ABBREV: Record<string, string> = {
  pnt: "peanut", pb: "peanut butter", btr: "butter", bttr: "butter", crmy: "creamy", crnchy: "crunchy", crnch: "crunchy",
  chkn: "chicken", chk: "chicken", ckn: "chicken", brst: "breast", thgh: "thigh", grnd: "ground", gr: "ground", bf: "beef", prk: "pork", trky: "turkey", trk: "turkey",
  ssg: "sausage", sausg: "sausage", bcn: "bacon", lvrwrst: "liverwurst", lvr: "liver", slcd: "sliced", slc: "sliced", bnls: "boneless", sknls: "skinless",
  mlk: "milk", chs: "cheese", chse: "cheese", chdr: "cheddar", mozz: "mozzarella", ygrt: "yogurt", yog: "yogurt", crm: "cream", sr: "sour", whp: "whipped",
  jce: "juice", jc: "juice", org: "organic", orgnc: "organic", ntrl: "natural", nat: "natural", whl: "whole", wht: "white", wh: "white", brn: "brown",
  frz: "frozen", frzn: "frozen", frsh: "fresh", veg: "vegetable", vegs: "vegetables", frt: "fruit", strwbry: "strawberry", strwb: "strawberry", bnna: "banana", ban: "banana",
  lttc: "lettuce", ltc: "lettuce", sld: "salad", spnch: "spinach", tmato: "tomato", tmt: "tomato", avo: "avocado", avcdo: "avocado", ptato: "potato", pot: "potato", onn: "onion",
  brd: "bread", wwb: "whole wheat bread", bgl: "bagel", trtla: "tortilla", trt: "tortilla", crkr: "cracker", crkrs: "crackers", ckie: "cookie", ckies: "cookies",
  ndl: "noodle", ndls: "noodles", nddl: "noodle", sou: "soup",
  cerl: "cereal", crl: "cereal", oatml: "oatmeal", grnla: "granola", pst: "pasta", mac: "macaroni", rce: "rice", bns: "beans", sp: "soup", sce: "sauce", drsg: "dressing",
  pnts: "peanuts", nts: "nuts", almd: "almond", almnd: "almond", pcn: "pecan", pcns: "pecans", wlnt: "walnut", chcl: "chocolate", choc: "chocolate", cndy: "candy",
  wtr: "water", sprk: "sparkling", sda: "soda", cff: "coffee", cffe: "coffee", gf: "gluten free", df: "dairy free", sf: "sugar free", lf: "low fat", ff: "fat free",
  egg: "eggs", eggs: "eggs", lrg: "large", lg: "large", xl: "extra large", sm: "small", med: "medium", dz: "dozen", dzn: "dozen",
  dog: "dog", fd: "food", ct: "count", pk: "pack", pkg: "package", bx: "box", bg: "bag", btl: "bottle", cn: "can", jr: "jar", tb: "tub",
  bby: "baby", frmla: "formula", frml: "formula", infnt: "infant", tddlr: "toddler", wps: "wipes", dpr: "diapers", dprs: "diapers",
  vit: "vitamin", vits: "vitamins", supp: "supplement", gummy: "gummies", tbl: "tablets", tabs: "tablets", caps: "capsules",
  shmp: "shampoo", cond: "conditioner", lotn: "lotion", snscrn: "sunscreen", tpst: "toothpaste", deo: "deodorant",
  mug: "mug", tmblr: "tumbler", trvl: "travel", blndr: "blender", bl: "blender",
  hny: "honey", rstd: "roasted", rst: "roasted", smkd: "smoked", dli: "deli", rte: "ready to eat",
};
const ABBREV_KEYS = Object.keys(ABBREV).sort((a, b) => b.length - a.length);

const SKIP = /\b(sub ?total|total|tax|change|cash|visa|mastercard|master card|amex|discover|debit|credit|balance|savings|you saved|coupon|cpn|tender|auth|approved|items? sold|thank|welcome|store|cashier|register|reg\b|trans|transaction|ref\b|invoice|receipt|member|rewards|points|fuel|survey|www\.|\.com|tel|phone|\(\d{3}\)|\d{3}-\d{3}-\d{4}|loyalty|card|acct|account|chip|contactless|signature|customer copy|merchant|return policy|bottle dep|crv|bag fee|discount|promo|manager|st#|op#|te#|tc#|tr#|visit us)\b/i;
const PRICE_RE = /(-?\$?\d{1,4}\.\d{2})\s*(?:[A-Z]{1,2}|\*|-)?\s*$/;
const UNITS = new Set(["oz", "z", "lb", "lbs", "ct", "pk", "fl", "ml", "l", "g", "kg", "ea", "each", "qty", "x", "pc", "pcs", "in", "ft", "gal", "gallon", "qt", "quart", "pt", "pint", "dz", "doz", "dozen"]);
const STOP = new Set(["the", "and", "with", "of", "for", "a", "an", "in", "on", "to", "by", "per", "or", "w", "n", "it", "at", "size", "pack", "count", "package", "box", "bag", "bottle", "can", "jar", "tub", "large", "small", "medium", "extra", "fresh", "natural", "value", "select", "brand", "food", "product", "item"]);

export function detectStore(text: string): string | null {
  const head = text.split(/\r?\n/).slice(0, 8).join(" ");
  for (const [re, name] of STORES) if (re.test(head)) return name;
  for (const [re, name] of STORES) if (re.test(text)) return name;
  return null;
}

export function detectDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/) ?? text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[0].startsWith("20") && m[0].length === 10) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    mo = Number(m[1]);
    d = Number(m[2]);
    y = Number(m[3]);
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Expand "KRGR CRMY PNT BTR 16Z" → "kroger creamy peanut butter 16 oz". */
export function expandLine(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9&'.\- ]/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(oz|z|lb|lbs|fl ?oz|ml|l|g|kg|ct|pk)\b/g, "$1 $2"); // "16z" → "16 z"
  s = s.replace(/\b(\d+)z\b/g, "$1 oz").replace(/\b(\d+) z\b/g, "$1 oz");
  const words = s.split(" ").map((w, i) => {
    const key = w.replace(/[.'-]/g, "");
    if (/^\d/.test(key)) return w;
    // Store-brand prefixes ("KRGR", "GV") expand to the brand people know.
    if (i === 0 && STORE_BRANDS[key] && key.length <= 4) return STORE_BRANDS[key]!;
    for (const k of ABBREV_KEYS) if (key === k) return ABBREV[k]!;
    return w;
  });
  return words.join(" ").replace(/\s+/g, " ").trim();
}

export function guessBrand(expanded: string, raw: string): string | null {
  const low = expanded.replace(/[^a-z0-9& ]/g, "");
  for (const b of BRANDS.slice().sort((a, b2) => b2.length - a.length)) {
    const nb = b.replace(/[^a-z0-9& ]/g, "");
    if (new RegExp(`(^|\\s)${nb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(low)) return b;
  }
  const first = raw.toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9&]/g, "") ?? "";
  if (first && STORE_BRANDS[first]) return STORE_BRANDS[first]!;
  const firstTwo = raw.toLowerCase().split(/\s+/).slice(0, 2).join(" ").replace(/[^a-z0-9& ]/g, "");
  if (STORE_BRANDS[firstTwo]) return STORE_BRANDS[firstTwo]!;
  return null;
}

export function termsFor(expanded: string, brand: string | null): string[] {
  // Same vocabulary as the label scanner (scan/terms.ts), so a receipt line and a typed name for
  // the same product get the same verdict.
  const withoutUnits = expanded
    .split(" ")
    .filter((w) => !/^\d/.test(w) && !UNITS.has(w))
    .join(" ");
  return productTerms(withoutUnits, { brand, max: 6 });
}

/**
 * Parse OCR text into line items. Handles prices on the same line or the next line, quantity
 * lines ("2 @ 3.49"), tax flags, and skips totals/payment/boilerplate.
 */
const ADDRESS = /\b\d{1,6}\s+\w[\w .]*\b(st|street|ave|avenue|rd|road|blvd|dr|drive|way|hwy|highway|pkwy|ln|lane|plaza|ctr|center|mall)\b\.?$|\b[A-Z]{2}\s+\d{5}(-\d{4})?\b|^\d{1,2}:\d{2}(\s*[ap]m)?$/i;

export function parseReceipt(text: string): ParsedReceipt {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const items: ReceiptLine[] = [];
  let skipped = 0;
  let pendingQty = 1;
  const store = detectStore(text);
  // A real receipt prints a price on every item line (sometimes on the next line). A typed-in
  // list usually has none. Only insist on prices when the text has them.
  const hasPrices = lines.some((l) => PRICE_RE.test(l) || /^\$?-?\d{1,4}\.\d{2}\s*[A-Z]?$/.test(l));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const bareStoreName = !!store && STORES.some(([re, name]) => name === store && re.test(line)) && line.replace(/[^a-z]/gi, "").length <= store.replace(/[^a-z]/gi, "").length + 2;
    if (ADDRESS.test(line) || bareStoreName) {
      skipped += 1; // "KROGER", "1234 MAIN ST", "RICHMOND VA 23220"
      continue;
    }
    const qty = line.match(/^(\d{1,2})\s*@\s*\$?\d+\.\d{2}/);
    if (qty) {
      pendingQty = Number(qty[1]);
      continue;
    }
    if (/^\$?-?\d{1,4}\.\d{2}\s*[A-Z]?$/.test(line)) continue; // bare price line (consumed by previous item)
    if (SKIP.test(line)) {
      skipped += 1;
      continue;
    }
    let desc = line;
    let price: number | null = null;
    const pm = line.match(PRICE_RE);
    if (pm) {
      price = Number(pm[1]!.replace("$", ""));
      desc = line.slice(0, pm.index).trim();
    } else {
      // Price might be on the next line (column OCR).
      const next = lines[i + 1];
      const nm = next?.match(/^\$?(-?\d{1,4}\.\d{2})\s*[A-Z]?$/);
      if (nm) price = Number(nm[1]);
    }
    if (hasPrices && price == null) {
      skipped += 1; // header/footer text on a priced receipt
      continue;
    }
    desc = desc.replace(/^\d{6,}\s+/, "").replace(/\s+\d{6,}$/, ""); // leading/trailing UPC/PLU
    desc = desc.replace(/\b[A-Z]\s*$/, "").trim(); // trailing tax flag
    const letters = desc.replace(/[^A-Za-z]/g, "").length;
    if (letters < 3 || /^[\d\s.$-]+$/.test(desc)) {
      skipped += 1;
      continue;
    }
    if (price != null && price < 0) {
      skipped += 1; // refunds / coupon lines
      continue;
    }
    const expanded = expandLine(desc);
    const brand = guessBrand(expanded, desc);
    // A line with no usable terms ("MILK") stays on the list so the user sees it was read; it
    // simply cannot match anything and reads as clear.
    const terms = termsFor(expanded, brand);
    items.push({ raw: desc, product: expanded, brand, terms, price, quantity: pendingQty });
    pendingQty = 1;
  }
  return { store, date: detectDate(text), items, skipped };
}
