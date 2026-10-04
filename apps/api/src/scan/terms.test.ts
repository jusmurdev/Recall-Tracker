import { describe, expect, it } from "vitest";
import { isGeneric, isGenericTerm, productTerms, termWeight } from "./terms.js";
import { cleanGtinInput, displayGtin, normalizeGtin } from "./gtin.js";

describe("product terms", () => {
  it("ranks the phrase, distinctive words and pairs; drops generic singles", () => {
    expect(productTerms("Prairie Paws dog food")).toEqual(["prairie paws dog food", "prairie", "paws", "prairie paws", "paws dog", "dog food"]);
    expect(productTerms("kroger creamy peanut butter 16 oz", { brand: "kroger" })).toEqual(["kroger", "kroger creamy peanut butter", "kroger creamy", "creamy peanut", "peanut butter"]);
  });
  it("weights generic words low and phrases high", () => {
    expect(isGeneric("milk")).toBe(true);
    expect(isGeneric("jif")).toBe(false);
    expect(isGenericTerm("dog food")).toBe(true);
    expect(isGenericTerm("prairie paws")).toBe(false);
    expect(termWeight("milk")).toBeLessThan(termWeight("jif"));
    expect(termWeight("dog food")).toBeLessThan(termWeight("prairie paws"));
    expect(termWeight("prairie paws dog food")).toBeGreaterThanOrEqual(termWeight("prairie paws"));
  });
});

describe("GTIN normalization", () => {
  it("treats UPC-A and its EAN-13 form as the same code", () => {
    expect(normalizeGtin("087654321098")).toBe(normalizeGtin("0087654321098"));
    expect(normalizeGtin("087654321098")).toBe("00087654321098");
  });
  it("strips spaces and dashes from typed codes and rejects junk", () => {
    expect(cleanGtinInput("0 51500 24128 1")).toBe("00051500241281");
    expect(cleanGtinInput("4-11303-21309")).toBe("00041130321309");
    expect(cleanGtinInput("123")).toBeNull();
    expect(cleanGtinInput("abc")).toBeNull();
  });
  it("displays UPC-A as 12 digits again", () => {
    expect(displayGtin("00051500241281")).toBe("051500241281");
    expect(displayGtin("05012345678900")).toBe("5012345678900");
  });
});
