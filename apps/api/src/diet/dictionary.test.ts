import { describe, expect, it } from "vitest";
import { DICTIONARY_VERSION, ENTRIES, entryFor } from "./dictionary.js";
import { dietHitsForLabel, matchRecallForDiet, scanText, termRegex } from "./match.js";

const recall = (over: Partial<{ title: string; summary: string; productDescription: string; reason: string; codeInfo: string | null }>) => ({
  title: "Acme Foods: Chocolate Chip Cookies, 12 oz",
  summary: "",
  productDescription: "Chocolate Chip Cookies, 12 oz bag",
  reason: "",
  codeInfo: null,
  ...over,
});

describe("dietary dictionary", () => {
  it("is versioned and covers every profile with hidden sources", () => {
    expect(DICTIONARY_VERSION).toBeGreaterThanOrEqual(1);
    expect(entryFor("allergy_milk").terms).toEqual(expect.arrayContaining(["casein", "whey", "lactose", "ghee"]));
    expect(entryFor("allergy_egg").terms).toEqual(expect.arrayContaining(["albumin", "lysozyme"]));
    expect(entryFor("allergy_soy").terms).toEqual(expect.arrayContaining(["soy lecithin", "hydrolyzed soy protein"]));
    expect(entryFor("allergy_wheat").terms).toEqual(expect.arrayContaining(["semolina", "spelt", "farro", "seitan"]));
    expect(entryFor("gluten_free").terms).toEqual(expect.arrayContaining(["barley", "rye", "malt", "brewer's yeast"]));
    expect(entryFor("halal").terms).toEqual(expect.arrayContaining(["pork gelatin", "lard", "carmine", "alcohol", "pepsin"]));
    expect(entryFor("kosher").terms).toEqual(expect.arrayContaining(["pork", "shrimp", "lard"]));
    expect(entryFor("vegan").terms).toEqual(expect.arrayContaining(["gelatin", "honey", "whey", "carmine", "chicken", "isinglass"]));
    expect(ENTRIES.map((e) => e.profile)).toHaveLength(13);
  });

  it("matches on word boundaries, case-insensitively, with plurals", () => {
    expect(termRegex("peanut").test("Contains PEANUTS")).toBe(true);
    expect(termRegex("egg").test("eggplant parmesan")).toBe(false);
    expect(termRegex("nut").test("nutmeg")).toBe(false);
    expect(termRegex("anchovy").test("with anchovies")).toBe(true);
    expect(termRegex("tree nut").test("tree-nuts")).toBe(true);
    expect(termRegex("fish").test("fishes")).toBe(true);
    expect(scanText("Ingredients: wheat flour, sugar, CASEIN", entryFor("allergy_milk")).map((h) => h.term)).toEqual(["casein"]);
  });

  it("ignores negations but never an explicit undeclared statement", () => {
    expect(scanText("peanut-free facility", entryFor("allergy_peanut"))).toEqual([]);
    expect(scanText("Does not contain milk", entryFor("allergy_milk"))).toEqual([]);
    expect(scanText("free from gluten and wheat", entryFor("gluten_free"))).toEqual([]);
    expect(scanText("contains no soy", entryFor("allergy_soy"))).toEqual([]);
    const hit = scanText("Product labeled dairy-free was found to contain undeclared milk.", entryFor("allergy_milk"));
    expect(hit.map((h) => [h.term, h.kind])).toEqual([["milk", "undeclared"]]);
  });

  it("recognises undeclared wording before and after the term", () => {
    expect(scanText("Undeclared peanuts", entryFor("allergy_peanut"))[0]!.kind).toBe("undeclared");
    expect(scanText("The product may contain almonds that are not declared on the label", entryFor("allergy_tree_nut")).map((h) => h.kind)).toContain("undeclared");
    expect(scanText("Jars contain peanut butter", entryFor("allergy_peanut"))[0]!.kind).toBe("mention");
  });

  it("marks ambiguous terms as ambiguous, not certain", () => {
    expect(scanText("Ingredients: sugar, gelatin, natural flavors", entryFor("halal")).map((h) => [h.term, h.kind])).toEqual([
      ["gelatin", "ambiguous"],
      ["natural flavors", "ambiguous"],
    ]);
    expect(scanText("Ingredients: sugar, pork gelatin", entryFor("halal")).map((h) => [h.term, h.kind])).toEqual(expect.arrayContaining([["pork gelatin", "mention"]]));
  });
});

describe("recall matching for a dietary profile", () => {
  const peanutUser = { dietProfiles: ["allergy_peanut"], otherAllergens: [] };

  it("alerts a peanut-allergic user for an undeclared-peanut recall, at least high severity", () => {
    const { best } = matchRecallForDiet(recall({ reason: "Undeclared peanuts; product may contain peanut from a shared line." }), peanutUser);
    expect(best).toMatchObject({ profile: "allergy_peanut", kind: "undeclared", minSeverity: "high" });
    expect(best!.score).toBeGreaterThanOrEqual(0.9);
    expect(best!.explanation).toBe("Undeclared peanuts. You listed peanut allergy. Check the package before eating.");
  });

  it("does not alert for an unrelated recall, or for a peanut product recalled for another reason", () => {
    expect(matchRecallForDiet(recall({ reason: "Potential Listeria monocytogenes contamination." }), peanutUser).best).toBeNull();
    expect(matchRecallForDiet(recall({ title: "Acme: Peanut Butter Cups", productDescription: "Peanut Butter Cups 8 oz", reason: "May contain metal fragments." }), peanutUser).best).toBeNull();
    // ...unless the recall is about labeling, in which case the product's own allergen matters.
    expect(matchRecallForDiet(recall({ title: "Acme: Peanut Butter Cups", productDescription: "Peanut Butter Cups 8 oz", reason: "Mislabeled: packaged in cartons for a different product (undeclared allergen)." }), peanutUser).best?.profile).toBe("allergy_peanut");
  });

  it("handles free-text allergens", () => {
    const { best } = matchRecallForDiet(recall({ reason: "Undeclared mustard." }), { dietProfiles: [], otherAllergens: ["Mustard"] });
    expect(best).toMatchObject({ profile: "allergy_other", kind: "undeclared", label: "Mustard allergy" });
  });

  it("flags gluten sources for a gluten-free user including hidden ones", () => {
    const { best } = matchRecallForDiet(recall({ reason: "Undeclared wheat (semolina) in a product labeled gluten-free." }), { dietProfiles: ["gluten_free"], otherAllergens: [] });
    expect(best).toMatchObject({ profile: "gluten_free", kind: "undeclared" });
    expect(["wheat", "semolina"]).toContain(best!.term);
  });

  it("uses honest wording for halal and kosher: ingredients and certifiers, never a verdict", () => {
    const halal = matchRecallForDiet(recall({ productDescription: "Fruit snacks made with pork gelatin, 10 count", reason: "Undeclared pork-derived gelatin." }), { dietProfiles: ["halal"], otherAllergens: [] });
    expect(halal.best!.explanation).toMatch(/^Mentions pork/);
    expect(halal.best!.explanation).not.toMatch(/not halal|haram product/i);

    const kosher = matchRecallForDiet(recall({ productDescription: "Orthodox Union certified (OU-D) chocolate bars", reason: "Undeclared almonds." }), { dietProfiles: ["kosher"], otherAllergens: [] });
    expect(kosher.best).toMatchObject({ profile: "kosher", kind: "certification" });
    expect(kosher.best!.explanation).toContain("kosher-certified product");

    const cross = matchRecallForDiet(recall({ reason: "Dairy ingredient in a meat product: milk in meat sausages." }), { dietProfiles: ["kosher"], otherAllergens: [] });
    expect(cross.best!.kind).toBe("cross_contact");

    // A shrimp recall for Listeria is a mention for kosher users (named in the reason/description).
    const treif = matchRecallForDiet(recall({ title: "Sea Co: Cooked Shrimp", productDescription: "Cooked shrimp 1 lb", reason: "Listeria" }), { dietProfiles: ["kosher"], otherAllergens: [] });
    expect(treif.best).toMatchObject({ profile: "kosher", kind: "mention", term: "shrimp" });
    expect(treif.best!.score).toBe(0.5);
  });

  it("flags animal-derived ingredients for a vegan user, but not a plainly animal product recalled for another reason", () => {
    const vegan = { dietProfiles: ["vegan"], otherAllergens: [] };
    const egg = matchRecallForDiet(recall({ title: "Green Fields: Plant-Based Mayo", productDescription: "Plant-Based Mayo 12 oz", reason: "Undeclared egg: jars labeled vegan contain egg-based mayonnaise." }), vegan);
    expect(egg.best).toMatchObject({ profile: "vegan", kind: "undeclared" });
    expect(egg.best!.explanation).toBe("Undeclared egg, an animal-derived ingredient. You eat vegan.");
    expect(egg.best!.minSeverity).toBeNull(); // not an allergy: no severity floor
    const honey = matchRecallForDiet(recall({ reason: "Product contains honey not listed on the label." }), vegan);
    expect(honey.best).toMatchObject({ profile: "vegan", term: "honey", kind: "undeclared" });
    // A chicken recall for Listeria is not news to someone who never buys chicken.
    expect(matchRecallForDiet(recall({ title: "Farm Co: Chicken Breast", productDescription: "Boneless chicken breast 1 lb", reason: "Listeria" }), vegan).best).toBeNull();
    // Negation respected; ambiguous words shown as such on labels.
    expect(matchRecallForDiet(recall({ reason: "Certified vegan, contains no dairy or egg; recalled for metal fragments." }), vegan).best).toBeNull();
    const label = dietHitsForLabel("INGREDIENTS: SUGAR, GLYCERIN, NATURAL FLAVORS, CARMINE", vegan);
    expect(label.map((h) => [h.term, h.kind])).toEqual([["carmine", "mention"]]);
  });

  it("picks the strongest hit when several profiles fire", () => {
    const { best, all } = matchRecallForDiet(recall({ reason: "Undeclared milk and soy." }), { dietProfiles: ["allergy_soy", "allergy_milk", "kosher"], otherAllergens: [] });
    expect(best!.kind).toBe("undeclared");
    expect(all.map((h) => h.profile)).toEqual(expect.arrayContaining(["allergy_milk", "allergy_soy"]));
  });
});

describe("label heads-up", () => {
  it("reports one line per profile from OCR text, recall or not", () => {
    const hits = dietHitsForLabel("INGREDIENTS: ENRICHED FLOUR (WHEAT FLOUR), SUGAR, SOY LECITHIN, NATURAL FLAVORS, GELATIN. MAY CONTAIN PEANUTS.", { dietProfiles: ["allergy_peanut", "allergy_soy", "halal", "allergy_fish"], otherAllergens: [] });
    const byProfile = Object.fromEntries(hits.map((h) => [h.profile, h]));
    expect(byProfile.allergy_peanut.kind).toBe("undeclared"); // "may contain" is a precautionary statement
    expect(byProfile.allergy_soy.kind).toBe("mention");
    expect(byProfile.halal.kind).toBe("ambiguous");
    expect(byProfile.allergy_fish).toBeUndefined();
  });
});
