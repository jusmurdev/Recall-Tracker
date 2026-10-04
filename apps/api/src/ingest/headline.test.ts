import { describe, expect, it } from "vitest";
import { cleanHeadline, isShouting, sentenceCase } from "./headline.js";
import { extractBrands } from "./normalize.js";

describe("headline cleaner", () => {
  it("strips the company prefix and codes from our FDA titles", () => {
    expect(cleanHeadline({ title: "J.M. Smucker Co.: Jif Creamy Peanut Butter, 16 oz plastic jar, UPC 0 51500 24128 1", company: "J.M. Smucker Co." })).toBe("Jif Creamy Peanut Butter");
  });
  it("sentence-cases shouting source titles and drops pack sizes", () => {
    expect(isShouting("SYSCO BLEND LETT/ROM 50/50 NOCLR 4/5# CASE")).toBe(true);
    expect(cleanHeadline({ title: "SYSCO FOODS: SYSCO BLEND LETT/ROM 50/50 NOCLR 4/5# CASE, LOT 2291", company: "Sysco Foods" })).toBe("Sysco blend lett/rom noclr");
    expect(sentenceCase("USDA CHOICE BEEF")).toBe("USDA choice beef");
  });
  it("pulls the product out of agency headlines", () => {
    expect(cleanHeadline({ title: "Acme Foods Recalls Ready-To-Eat Liverwurst Products Due to Possible Listeria Contamination", company: "Acme Foods" })).toBe("Ready-To-Eat Liverwurst Products");
    expect(cleanHeadline({ title: "Public Health Alert: Hill Country Fare Chicken Salad", company: "" })).toBe("Hill Country Fare Chicken Salad");
  });
  it("never exceeds the maximum length and cuts at a word", () => {
    const long = cleanHeadline({ title: "Some Company: " + "Very ".repeat(40) + "Long Product Name" });
    expect(long.length).toBeLessThanOrEqual(70);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("brand extraction", () => {
  it("finds brands from trademark symbols, 'under the X label' and the leading proper noun", () => {
    expect(extractBrands("Jif® Creamy Peanut Butter, 16 oz")).toContain("Jif");
    expect(extractBrands("Peanut butter sold under the Great Value label in 16 oz jars")).toContain("Great Value");
    expect(extractBrands("Prairie Paws Freeze-Dried Raw Chicken Dog Food, 14 oz bag")).toContain("Prairie Paws");
    expect(extractBrands("Sunny Valley Cold-Pressed Green Juice, 12 fl oz")).toContain("Sunny Valley");
  });
  it("does not treat generic openers as brands", () => {
    expect(extractBrands("Various frozen vegetables packed in 1 lb bags")).toEqual([]);
    expect(extractBrands("Ready-to-eat chicken salad")).toEqual([]);
  });
});
