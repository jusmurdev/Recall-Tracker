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
    const long = cleanHeadline({ title: "Some Company: " + "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango " + "Long Product Name" });
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

describe("headline cleaner on medical-device catalog titles", () => {
  it("strips label prefixes, part numbers and size specs, and calms shouting words", () => {
    expect(cleanHeadline({ title: "Brand Name: VERIQA", company: "Acme Medical" })).toBe("Veriqa");
    expect(cleanHeadline({ title: "Convenience kits MYRINGOTOMY PACK-LF DYNJ59097A", company: "Medline" })).toBe("Convenience kits myringotomy pack-lf");
    expect(cleanHeadline({ title: "Haylard BASIC BIOPSY TRAY", company: "Haylard" })).toBe("Haylard basic biopsy tray");
    expect(cleanHeadline({ title: "TRIATHLON HINGE INSERT SIZE 4 11MM 5612-P-411 STERILE", company: "Stryker" })).toBe("Triathlon hinge insert sterile");
    expect(cleanHeadline({ title: "Stryker: Catalog No. 5612-P-411 Triathlon Hinge Insert", company: "Stryker" })).toBe("Triathlon Hinge Insert");
  });
  it("leaves ordinary titles and known acronyms alone", () => {
    expect(cleanHeadline({ title: "J.M. Smucker Co.: Jif Creamy Peanut Butter", company: "J.M. Smucker Co." })).toBe("Jif Creamy Peanut Butter");
    expect(cleanHeadline({ title: "USDA Choice Beef Patties", company: "" })).toBe("USDA Choice Beef Patties");
  });
});

describe("headline cleaner on round-3 device titles", () => {
  it("drops mis-decoded trademark marks", () => {
    expect(cleanHeadline({ title: "C.R. Bard, Inc.: Bard¿ Foley Tray With Urine Meter", company: "C.R. Bard, Inc." })).toBe("Bard Foley Tray With Urine Meter");
    expect(cleanHeadline({ title: "Bayer: Medrad¿ Stellant flex Syringe Kit", company: "Bayer" })).toBe("Medrad Stellant flex Syringe Kit");
  });
  it("uses the product family instead of a numbered list", () => {
    expect(cleanHeadline({ title: "Medline Convenience Kits: 1) neuro pack DYNJ12345, 2) spine pack", company: "Medline Industries, LP" })).toBe("Medline Convenience Kits");
    const listOnly = cleanHeadline({ title: "Medline Industries, LP: 1) neuro", company: "Medline Industries, LP", productDescription: "1) Neuro Pack DYNJ59097A, 2) Spine Pack DYNJ59098A" });
    expect(listOnly).toBe("Medline neuro Pack");
    expect(listOnly.startsWith("1)")).toBe(false);
  });
  it("removes 'Products that contain' boilerplate", () => {
    expect(cleanHeadline({ title: "Products that contain the Pericare Wipes: Admission Kit A, Admission Kit B, Admission Kit C with basin", company: "Medline Industries, LP" })).toBe("Pericare Wipes");
  });
  it("expands pharmacy shorthand and falls back when too little is left", () => {
    expect(cleanHeadline({ title: "Hospira, Inc.: Dopamine HCl Inj", company: "Hospira, Inc." })).toBe("Dopamine HCl Injection");
    expect(cleanHeadline({ title: "C.R. Bard, Inc.: Bardex¿ I", company: "C.R. Bard, Inc.", productDescription: "Bardex I.C. Foley Catheter, 16 Fr" })).toBe("Bardex");
  });
  it("trims catalog fragments, repeats and dangling letters from raw device titles", () => {
    expect(cleanHeadline({ title: "ABG I ACETABULAR INSERT HOODED ID X ACETABULAR INSERT / OD X ID C-", company: "Stryker" })).toBe("ABG acetabular insert hooded");
  });
});
