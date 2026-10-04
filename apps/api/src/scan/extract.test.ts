import { describe, expect, it } from "vitest";
import { extractFromOcr } from "./extract.js";

describe("extractFromOcr", () => {
  it("pulls brand and product terms from a label", () => {
    const ocr = `Jif
CREAMY
PEANUT BUTTER
NET WT 16 OZ (454g)
Nutrition Facts
Serving size 2 Tbsp (32g)
Calories 190
INGREDIENTS: ROASTED PEANUTS, SUGAR, MOLASSES
Best By 10/2027`;
    const r = extractFromOcr(ocr, "bought at Costco");
    expect(r.brand).toBe("Jif");
    expect(r.terms).toContain("jif");
    expect(r.terms).toContain("peanut butter");
    expect(r.terms.join(" ")).not.toMatch(/nutrition|serving|calories/);
    expect(r.upc).toBeNull();
  });
  it("normalises a barcode", () => {
    expect(extractFromOcr(undefined, undefined, "0 51500 24128 1").upc).toBe("051500241281");
    expect(extractFromOcr(undefined, undefined, "123").upc).toBeNull();
  });
  it("uses context when OCR is empty", () => {
    const r = extractFromOcr("", "Boar's Head liverwurst");
    expect(r.terms).toContain("boar's head liverwurst");
  });
});
