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
    expect(extractFromOcr(undefined, undefined, "0 51500 24128 1").upc).toBe("00051500241281");
    expect(extractFromOcr(undefined, undefined, "123").upc).toBeNull();
  });
  it("uses context when OCR is empty", () => {
    const r = extractFromOcr("", "Boar's Head liverwurst");
    expect(r.terms).toContain("boar's head liverwurst");
  });
});

describe("typed product names", () => {
  it("keeps the brand words usable when the whole phrase is not in the recall title", () => {
    const r = extractFromOcr("Prairie Paws dog food");
    expect(r.terms).toContain("prairie paws dog food");
    expect(r.terms).toContain("prairie paws");
    expect(r.terms).toContain("prairie");
    expect(r.terms).toContain("paws");
    expect(r.terms).not.toContain("food");
    expect(r.terms).not.toContain("dog");
  });
  it("never emits a generic word as a term on its own", () => {
    expect(extractFromOcr("MILK").terms).toEqual([]);
    expect(extractFromOcr("whole milk").terms).toEqual(["whole milk"]);
  });
});
