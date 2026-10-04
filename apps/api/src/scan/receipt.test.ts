import { describe, expect, it } from "vitest";
import { detectDate, detectStore, expandLine, guessBrand, parseReceipt } from "./receipt.js";

const KROGER = `KROGER
1234 MAIN ST
RICHMOND VA 23220
(804) 555-0100
10/02/2026 14:32 ST# 041 OP# 55
JIF CRMY PNT BTR 16Z      3.49 F
BOARS HEAD LVRWRST         6.99 F
2 @ 1.29
BNNA ORG                   2.58 F
KRGR WHL MLK GAL           3.19 F
STANLEY TRVL MUG 12OZ     24.99 T
0011110123456
SUNNY VALLEY GRN JCE 12Z   4.49 F
SUBTOTAL                  45.73
TAX                        1.50
TOTAL                     47.23
VISA                      47.23
YOU SAVED                  2.00
THANK YOU FOR SHOPPING KROGER`;

describe("receipt parser", () => {
  it("expands cashier shorthand", () => {
    expect(expandLine("JIF CRMY PNT BTR 16Z")).toBe("jif creamy peanut butter 16 oz");
    expect(expandLine("KRGR WHL MLK GAL")).toBe("kroger whole milk gal");
    expect(expandLine("CHKN BRST BNLS SKNLS")).toBe("chicken breast boneless skinless");
    expect(expandLine("GV PNT BTR")).toBe("great value peanut butter");
  });
  it("guesses brands, including store brands", () => {
    expect(guessBrand(expandLine("JIF CRMY PNT BTR 16Z"), "JIF CRMY PNT BTR 16Z")).toBe("jif");
    expect(guessBrand(expandLine("BOARS HEAD LVRWRST"), "BOARS HEAD LVRWRST")).toBe("boar's head");
    expect(guessBrand(expandLine("GV PNT BTR"), "GV PNT BTR")).toBe("great value");
    expect(guessBrand(expandLine("KRGR WHL MLK"), "KRGR WHL MLK")).toBe("kroger");
    expect(guessBrand("bananas", "BNNA")).toBeNull();
  });
  it("detects the store and date", () => {
    expect(detectStore(KROGER)).toBe("Kroger");
    expect(detectDate(KROGER)).toBe("2026-10-02");
    expect(detectStore("WAL-MART SUPERCENTER\nGV MILK 2.99")).toBe("Walmart");
    expect(detectDate("no date here")).toBeNull();
  });
  it("parses line items and skips totals, payments and boilerplate", () => {
    const r = parseReceipt(KROGER);
    expect(r.store).toBe("Kroger");
    expect(r.items.map((i) => i.product)).toEqual([
      "jif creamy peanut butter 16 oz",
      "boars head liverwurst",
      "banana organic",
      "kroger whole milk gal",
      "stanley travel mug 12 oz",
      "sunny valley grn juice 12 oz",
    ]);
    expect(r.items[0]).toMatchObject({ brand: "jif", price: 3.49, quantity: 1 });
    expect(r.items[0]!.terms).toContain("peanut butter");
    expect(r.items[0]!.terms).toContain("jif");
    expect(r.items[3]!.terms).not.toContain("milk"); // generic words never stand alone
    expect(r.items[2]).toMatchObject({ price: 2.58, quantity: 2 });
    expect(r.items[4]!.terms).toContain("stanley");
    expect(r.items[5]!.terms).toContain("sunny valley");
    expect(r.skipped).toBeGreaterThanOrEqual(6);
  });
  it("handles prices OCR'd onto their own line and negative coupon lines", () => {
    const r = parseReceipt("TARGET\nGOOD & GATHER GRNLA\n4.99\nCOUPON\n-1.00\nORG SPNCH 5OZ\n3.49");
    expect(r.items.map((i) => i.product)).toEqual(["good & gather granola", "organic spinach 5 oz"]);
    expect(r.items[0]!.price).toBe(4.99);
  });
});
