import { describe, expect, it } from "vitest";
import { cleanText, extractBrands, extractRemedy, extractUpcs, parseCompactDate, parseDistributionStates, parseLooseDate } from "./normalize.js";

describe("parseDistributionStates", () => {
  it("detects nationwide", () => {
    expect(parseDistributionStates("Nationwide")).toEqual(["US"]);
    expect(parseDistributionStates("Distributed nationwide through online retailers")).toEqual(["US"]);
    expect(parseDistributionStates("Throughout the United States and Canada")).toEqual(["US"]);
  });
  it("parses state names and codes", () => {
    expect(parseDistributionStates("Texas and Oklahoma")).toEqual(["OK", "TX"]);
    expect(parseDistributionStates("CA, NV, AZ and OR")).toEqual(["AZ", "CA", "NV", "OR"]);
    expect(parseDistributionStates("Georgia, Florida, Alabama")).toEqual(["AL", "FL", "GA"]);
    expect(parseDistributionStates("West Virginia and Virginia")).toEqual(["VA", "WV"]);
  });
  it("ignores ambiguous codes that are ordinary words", () => {
    expect(parseDistributionStates("Sold IN stores OR online")).toEqual([]);
  });
  it("returns empty for nothing recognisable", () => {
    expect(parseDistributionStates("")).toEqual([]);
    expect(parseDistributionStates(undefined)).toEqual([]);
  });
});

describe("extractUpcs", () => {
  it("handles spaced and dashed UPC formats", () => {
    expect(extractUpcs("Jif Creamy, UPC 0 51500 24128 1. Lot 1274425")).toEqual(["00051500241281"]);
    expect(extractUpcs("UPC Code 4-11303-21309")).toEqual(["00041130321309"]);
    expect(extractUpcs("UPC: 851234007011")).toEqual(["00851234007011"]);
  });
  it("ignores short digit runs and dedupes", () => {
    expect(extractUpcs("Lot 1274425 UPC 851234007011 and 851234007011")).toEqual(["00851234007011"]);
  });
  it("finds bare GTINs", () => {
    expect(extractUpcs("Item 00012345678905 on shelf")).toEqual(["00012345678905"]);
  });
});

describe("extractBrands", () => {
  it("finds quoted names and 'X brand' patterns", () => {
    expect(extractBrands('3.5-lb loaves of "Boar\'s Head Strassburger Brand Liverwurst"')).toContain("Boar's Head Strassburger Brand Liverwurst");
    expect(extractBrands("Sunny Valley brand Cold-Pressed Green Juice")).toContain("Sunny Valley");
  });
});

describe("dates and text", () => {
  it("parses compact and loose dates", () => {
    expect(parseCompactDate("20260918")?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(parseCompactDate("bad")).toBeNull();
    expect(parseLooseDate("2026-09-30")?.toISOString().slice(0, 10)).toBe("2026-09-30");
    expect(parseLooseDate("Sep 30, 2026")?.getUTCFullYear()).toBe(2026);
    expect(parseLooseDate("")).toBeNull();
  });
  it("strips html", () => {
    expect(cleanText("<p>Hello&nbsp;<em>world</em></p>bye &amp; more")).toBe("Hello world\nbye & more");
  });
});

describe("extractRemedy", () => {
  it("picks the consumer-instruction sentences", () => {
    const text =
      "Acme is recalling its granola. The product was sold nationwide. Consumers who have purchased the product are urged to return it to the place of purchase for a full refund. Consumers with questions may contact the company at 800-555-0100. No illnesses have been reported.";
    const r = extractRemedy(text)!;
    expect(r).toContain("urged to return it to the place of purchase for a full refund");
    expect(r).toContain("contact the company");
    expect(r).not.toContain("sold nationwide");
  });
  it("returns null when nothing actionable is said", () => {
    expect(extractRemedy("Mislabeled: package states 8 oz but contains 7 oz.")).toBeNull();
    expect(extractRemedy("")).toBeNull();
  });
});
