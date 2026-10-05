import { describe, expect, it } from "vitest";
import { addOtherAllergen, dietHeadline, EMPTY_DIET, excerptAround, hasDiet, highlightSegments, normalizeAllergen, removeOtherAllergen, toggleProfile } from "./diet";

describe("diet settings state", () => {
  it("toggles profiles on and off without duplicates", () => {
    const on = toggleProfile(EMPTY_DIET, "allergy_peanut");
    expect(on.dietProfiles).toEqual(["allergy_peanut"]);
    expect(toggleProfile(toggleProfile(on, "halal"), "allergy_peanut").dietProfiles).toEqual(["halal"]);
    expect(hasDiet(EMPTY_DIET)).toBe(false);
    expect(hasDiet(on)).toBe(true);
  });

  it("normalizes and validates free-text allergens", () => {
    expect(normalizeAllergen("  Mustard ")).toBe("mustard");
    expect(normalizeAllergen("<script>")).toBeNull();
    expect(normalizeAllergen("x")).toBeNull();
    const a = addOtherAllergen(EMPTY_DIET, "Mustard");
    expect(a.next.otherAllergens).toEqual(["mustard"]);
    expect(addOtherAllergen(a.next, "mustard").next.otherAllergens).toEqual(["mustard"]); // no dupes
    expect(addOtherAllergen(a.next, "99").error).toMatch(/letters/i);
    expect(removeOtherAllergen(a.next, "mustard").otherAllergens).toEqual([]);
  });

  it("routes a typed built-in allergen to its toggle", () => {
    const r = addOtherAllergen(EMPTY_DIET, "peanuts");
    expect(r.next.dietProfiles).toEqual(["allergy_peanut"]);
    expect(r.next.otherAllergens).toEqual([]);
  });

  it("caps the free-text list at ten", () => {
    let d = EMPTY_DIET;
    for (const w of ["lupin", "celery", "mustard", "sulphite", "mollusc", "kiwi", "banana", "avocado", "corn", "garlic"]) d = addOtherAllergen(d, w).next;
    expect(d.otherAllergens).toHaveLength(10);
    expect(addOtherAllergen(d, "onion").error).toMatch(/up to 10/);
  });
});

describe("diet copy", () => {
  const base = { resolvedAt: null, dismissedAt: null };
  it("leads Home with the matching profile", () => {
    expect(dietHeadline([{ ...base, reason: "diet_match", dietProfile: "allergy_peanut", explanation: "Undeclared peanuts. You listed peanut allergy." }])).toBe("1 recall matches your peanut allergy");
    expect(
      dietHeadline([
        { ...base, reason: "diet_match", dietProfile: "allergy_peanut", explanation: "" },
        { ...base, reason: "diet_match", dietProfile: "halal", explanation: "" },
        { ...base, reason: "brand_match", dietProfile: null, explanation: "" },
      ]),
    ).toBe("2 recalls match your peanut allergy and halal diet");
    expect(dietHeadline([{ ...base, reason: "diet_match", dietProfile: "allergy_other", explanation: "Undeclared mustard. You listed mustard allergy." }])).toBe("1 recall matches your mustard allergy");
    expect(dietHeadline([{ ...base, reason: "diet_match", dietProfile: "vegan", explanation: "" }])).toBe("1 recall matches your vegan diet");
    expect(dietHeadline([{ ...base, reason: "diet_match", dietProfile: "allergy_peanut", explanation: "", resolvedAt: "2026-01-01T00:00:00Z" }])).toBeNull();
    // Profile emptied: old diet alerts are history, not a headline.
    const peanut = { ...base, reason: "diet_match" as const, dietProfile: "allergy_peanut", explanation: "" };
    expect(dietHeadline([peanut], EMPTY_DIET)).toBeNull();
    expect(dietHeadline([peanut], null)).toBeNull();
    expect(dietHeadline([peanut], { dietProfiles: ["allergy_peanut"], otherAllergens: [] })).toBe("1 recall matches your peanut allergy");
  });

  it("highlights the matched phrase and excerpts long text", () => {
    expect(highlightSegments("Undeclared Whey Protein in juice", "whey protein")).toEqual([
      { text: "Undeclared ", hit: false },
      { text: "Whey Protein", hit: true },
      { text: " in juice", hit: false },
    ]);
    expect(highlightSegments("nothing here", "milk")).toEqual([{ text: "nothing here", hit: false }]);
    const long = `${"a".repeat(300)} milk ${"b".repeat(300)}`;
    const ex = excerptAround(long, "milk", 20);
    expect(ex.startsWith("…")).toBe(true);
    expect(ex.endsWith("…")).toBe(true);
    expect(ex).toContain("milk");
  });
});
