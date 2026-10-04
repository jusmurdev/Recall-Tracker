/**
 * Dietary keyword dictionary, version-controlled and tested. Maps each profile to the words a
 * recall notice or a label uses for it: the plain name, synonyms, derived ingredients and hidden
 * sources (casein is milk, albumin is egg, semolina is wheat, lard is pork).
 *
 * Design notes
 * - Allergens: recall beats precision. Someone with a peanut allergy would rather dismiss an
 *   alert about "peanut oil" than miss one. Ambiguous terms (gelatin of unknown origin, "natural
 *   flavors") are listed separately so they can be shown as "might contain" or handed to the
 *   optional AI classifier, never silently promoted to a certain hit.
 * - Halal and kosher: recall text never certifies a product. We only flag named ingredients
 *   (pork, alcohol, carmine…), named certifiers, and explicit meat/dairy cross-contact wording.
 *   The UI says "mentions pork-derived gelatin", never "not halal".
 * - To extend: add a term to the right list below, add a test in dictionary.test.ts, bump
 *   DICTIONARY_VERSION. Terms are matched case-insensitively on word boundaries with simple
 *   plurals; multi-word terms accept spaces or hyphens between words.
 */
import type { DietProfile } from "@recall/shared";

export const DICTIONARY_VERSION = 1;

export interface DictionaryEntry {
  profile: DietProfile;
  /** Short noun for explanations: "peanuts", "milk", "pork", "gluten". */
  noun: string;
  /** Certain terms: a non-negated mention means the thing is present or suspected. */
  terms: readonly string[];
  /** Terms that only sometimes mean this (shown as "might contain"). */
  ambiguous?: readonly string[];
}

const MILK = ["milk", "dairy", "casein", "caseinate", "caseinates", "whey", "lactose", "lactalbumin", "lactoglobulin", "lactulose", "ghee", "butter", "buttermilk", "butterfat", "cream", "cheese", "yogurt", "yoghurt", "curd", "curds", "custard", "kefir", "paneer", "quark", "half and half", "milk solids", "milk powder", "milk protein", "sour cream", "cream cheese", "ice cream", "condensed milk", "evaporated milk", "nonfat dry milk", "recaldent", "tagatose"] as const;
const EGG = ["egg", "albumin", "albumen", "ovalbumin", "ovomucoid", "ovomucin", "ovovitellin", "lysozyme", "livetin", "globulin", "meringue", "mayonnaise", "egg white", "egg yolk", "egg wash", "dried egg", "egg powder", "egg lecithin", "surimi"] as const;
const FISH = ["fish", "anchovy", "cod", "salmon", "tuna", "tilapia", "haddock", "pollock", "pollack", "halibut", "hake", "herring", "mackerel", "sardine", "trout", "bass", "catfish", "snapper", "swordfish", "flounder", "grouper", "mahi mahi", "perch", "pike", "sole", "whitefish", "fish sauce", "fish oil", "fish gelatin", "isinglass", "caviar", "roe", "surimi", "worcestershire sauce", "caesar dressing", "fishmeal"] as const;
const SHELLFISH = ["shellfish", "crustacean", "shrimp", "prawn", "crab", "lobster", "crawfish", "crayfish", "langoustine", "langostino", "krill", "scampi", "barnacle", "mollusk", "mollusc", "clam", "oyster", "mussel", "scallop", "squid", "calamari", "octopus", "abalone", "snail", "escargot", "cockle", "whelk", "periwinkle", "sea urchin", "shrimp paste", "oyster sauce", "glucosamine"] as const;
const TREE_NUT = ["tree nut", "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "filbert", "macadamia", "brazil nut", "pine nut", "pignoli", "pignolia", "chestnut", "beechnut", "butternut", "chinquapin", "ginkgo nut", "hickory nut", "lychee nut", "lichee nut", "shea nut", "praline", "marzipan", "nougat", "gianduja", "frangipane", "nut butter", "nut milk", "almond milk", "almond flour", "almond extract", "nut oil", "pesto", "amaretto", "nutella"] as const;
const PEANUT = ["peanut", "groundnut", "ground nut", "arachis", "arachis oil", "peanut butter", "peanut oil", "peanut flour", "peanut protein", "beer nut", "monkey nut", "goober", "goober pea", "mandelona", "satay sauce", "nu-nuts"] as const;
const WHEAT = ["wheat", "wheat flour", "whole wheat", "enriched flour", "all purpose flour", "all-purpose flour", "bread flour", "cake flour", "pastry flour", "self rising flour", "self-rising flour", "bleached flour", "unbleached flour", "semolina", "durum", "spelt", "farro", "einkorn", "emmer", "kamut", "khorasan", "bulgur", "couscous", "seitan", "farina", "graham", "graham flour", "wheat germ", "wheat bran", "wheat starch", "wheat gluten", "vital wheat gluten", "hydrolyzed wheat protein", "hydrolysed wheat protein", "triticale", "freekeh", "matzo", "matzah", "matzoh", "breadcrumbs", "bread crumbs", "panko", "cracker meal", "fu", "udon", "orzo"] as const;
const SOY = ["soy", "soya", "soybean", "soy protein", "soy protein isolate", "hydrolyzed soy protein", "hydrolysed soy protein", "soy flour", "soy milk", "soy sauce", "shoyu", "tamari", "soy lecithin", "tofu", "tempeh", "edamame", "miso", "natto", "yuba", "okara", "textured vegetable protein", "tvp", "soy oil", "soybean oil", "bean curd"] as const;
const SESAME = ["sesame", "sesame seed", "sesame oil", "sesame paste", "sesame flour", "tahini", "tahina", "benne", "benne seed", "gingelly", "gingelly oil", "til", "halvah", "halva", "sesamol", "sesamolin", "sesamum indicum", "gomasio", "za'atar", "zaatar"] as const;
const GLUTEN = ["gluten", "wheat", "barley", "rye", "malt", "malt extract", "malt flavor", "malt flavoring", "malt vinegar", "malted barley", "barley malt", "brewer's yeast", "brewers yeast", "triticale", "spelt", "farro", "semolina", "durum", "einkorn", "emmer", "kamut", "bulgur", "couscous", "seitan", "farina", "graham", "wheat starch", "wheat germ", "wheat bran", "vital wheat gluten", "hydrolyzed wheat protein", "matzo", "panko", "breadcrumbs", "udon", "orzo", "contains gluten", "source of gluten"] as const;
/** Haram ingredients named in recall text or on a label. Never a certification judgment. */
const HARAM = ["pork", "pig", "porcine", "swine", "hog", "bacon", "ham", "lard", "pork gelatin", "porcine gelatin", "pork fat", "pork rind", "pork rinds", "pancetta", "prosciutto", "chorizo", "pepperoni", "salami", "mortadella", "pork sausage", "pepsin", "alcohol", "ethyl alcohol", "ethanol", "wine", "red wine", "white wine", "cooking wine", "rice wine", "mirin", "sake", "beer", "ale", "lager", "rum", "bourbon", "whiskey", "whisky", "vodka", "brandy", "cognac", "tequila", "liqueur", "liquor", "kirsch", "marsala", "sherry", "vermouth", "carmine", "cochineal", "carminic acid", "natural red 4", "e120", "non-halal", "not halal", "haram", "e441", "e542", "bone phosphate", "l-cysteine from hair"] as const;
const HARAM_AMBIGUOUS = ["gelatin", "gelatine", "natural flavors", "natural flavor", "natural flavoring", "natural flavourings", "enzymes", "rennet", "glycerin", "glycerol", "mono- and diglycerides", "monoglycerides", "diglycerides", "vanilla extract", "shortening", "animal fat", "animal shortening", "e471", "e472", "e631", "e635", "whey"] as const;
/** Explicitly non-kosher ingredients. */
const TREIF = ["pork", "pig", "porcine", "swine", "hog", "bacon", "ham", "lard", "pork gelatin", "porcine gelatin", "pancetta", "prosciutto", "pepperoni", "pork sausage", "shellfish", "shrimp", "prawn", "crab", "lobster", "crawfish", "crayfish", "clam", "oyster", "mussel", "scallop", "squid", "calamari", "octopus", "escargot", "snail", "catfish", "eel", "shark", "swordfish", "sturgeon", "rabbit", "horse meat", "non-kosher", "not kosher", "treif", "treyf"] as const;
const TREIF_AMBIGUOUS = ["gelatin", "gelatine", "rennet", "enzymes", "natural flavors", "natural flavor", "glycerin", "glycerol", "mono- and diglycerides", "carmine", "cochineal", "wine", "grape juice", "l-cysteine"] as const;

export const ENTRIES: readonly DictionaryEntry[] = [
  { profile: "allergy_milk", noun: "milk", terms: MILK, ambiguous: ["natural flavors", "natural flavor", "caramel color", "lactic acid starter culture", "brown sugar flavoring", "high protein flour", "margarine"] },
  { profile: "allergy_egg", noun: "egg", terms: EGG, ambiguous: ["lecithin", "natural flavors", "natural flavor", "pasta", "baked goods", "glaze"] },
  { profile: "allergy_fish", noun: "fish", terms: FISH, ambiguous: ["omega-3", "omega 3", "natural flavors", "natural flavor", "barbecue sauce", "bbq sauce", "bouillabaisse", "imitation crab"] },
  { profile: "allergy_shellfish", noun: "shellfish", terms: SHELLFISH, ambiguous: ["seafood", "seafood flavoring", "fish stock", "bouillabaisse", "cuttlefish ink", "squid ink"] },
  { profile: "allergy_tree_nut", noun: "tree nuts", terms: TREE_NUT, ambiguous: ["natural flavors", "natural flavor", "nut", "nuts", "mixed nuts", "nut extract", "barbecue sauce", "mortadella"] },
  { profile: "allergy_peanut", noun: "peanuts", terms: PEANUT, ambiguous: ["nut", "nuts", "mixed nuts", "natural flavors", "natural flavor", "hydrolyzed vegetable protein", "hydrolysed vegetable protein", "vegetable oil", "chili sauce", "mole sauce", "egg rolls"] },
  { profile: "allergy_wheat", noun: "wheat", terms: WHEAT, ambiguous: ["flour", "starch", "modified food starch", "natural flavors", "natural flavor", "soy sauce", "hydrolyzed vegetable protein", "gluten"] },
  { profile: "allergy_soy", noun: "soy", terms: SOY, ambiguous: ["lecithin", "vegetable oil", "vegetable protein", "hydrolyzed vegetable protein", "hydrolysed vegetable protein", "natural flavors", "natural flavor", "vegetable gum", "vegetable starch", "asian sauces"] },
  { profile: "allergy_sesame", noun: "sesame", terms: SESAME, ambiguous: ["natural flavors", "natural flavor", "spices", "spice blend", "seeds", "mixed seeds", "hummus", "falafel", "baba ghanoush"] },
  { profile: "gluten_free", noun: "gluten", terms: GLUTEN, ambiguous: ["oats", "oat", "oatmeal", "flour", "starch", "modified food starch", "natural flavors", "natural flavor", "soy sauce", "dextrin", "maltodextrin", "yeast extract", "hydrolyzed vegetable protein"] },
  { profile: "halal", noun: "a haram ingredient", terms: HARAM, ambiguous: HARAM_AMBIGUOUS },
  { profile: "kosher", noun: "a non-kosher ingredient", terms: TREIF, ambiguous: TREIF_AMBIGUOUS },
];

/** Kosher certifiers and marks; a recall that names one concerns a kosher-certified product. */
export const KOSHER_CERTIFIERS: readonly string[] = ["orthodox union", "ou kosher", "ou-d", "ou-p", "ou-m", "ou-dairy", "ok kosher", "star-k", "star k", "kof-k", "kof k", "crc kosher", "chicago rabbinical council", "kosher certified", "certified kosher", "kosher certification", "kosher symbol", "pareve", "parve", "kosher dairy", "kosher for passover", "glatt", "cholov yisroel", "chalav yisrael", "pas yisroel", "kashrut", "kashrus", "hechsher", "earth kosher", "scroll k", "triangle k", "kosher supervision"];

/** Phrases that mean an allergen was present but not on the label. */
export const UNDECLARED_CUES = [
  "undeclared",
  "not declared",
  "not listed",
  "not on the label",
  "not on the ingredient",
  "not in the ingredient",
  "unlabeled",
  "unlabelled",
  "mislabeled",
  "mislabelled",
  "mislabeling",
  "without declaring",
  "without listing",
  "fails to declare",
  "failed to declare",
  "failure to declare",
  "does not declare",
  "omits",
  "omitted",
  "wrong label",
  "incorrect label",
  "hidden",
  "presence of",
  "cross-contact",
  "cross contact",
  "cross-contamination",
  "cross contamination",
  "contaminated with",
  "may contain",
  "could contain",
  "potential to contain",
  "traces of",
  "trace amounts of",
  "exposed to",
] as const;

/** Phrases that mean the thing is absent, so a mention is not a hit. */
export const NEGATION_CUES = ["free of", "free from", "without", "does not contain", "doesn't contain", "do not contain", "don't contain", "contains no", "contain no", "no added", "absence of", "zero", "non", "not contain", "excludes", "excluding", "none of", "no "] as const;

/** Wording for explicit meat/dairy mixing (kosher). */
export const MEAT_DAIRY_CUES = ["meat and dairy", "dairy and meat", "meat with dairy", "dairy with meat", "milk in meat", "dairy in meat", "cheese in meat", "meat in dairy", "dairy ingredient in a meat", "milk ingredient in a meat", "mixed meat and dairy", "milchig", "fleishig", "fleischig"] as const;

export function entryFor(profile: DietProfile): DictionaryEntry {
  const e = ENTRIES.find((x) => x.profile === profile);
  if (!e) throw new Error(`No dictionary entry for ${profile}`);
  return e;
}

export const ALLERGY_PROFILES = new Set<DietProfile>(["allergy_milk", "allergy_egg", "allergy_fish", "allergy_shellfish", "allergy_tree_nut", "allergy_peanut", "allergy_wheat", "allergy_soy", "allergy_sesame"]);
export const isAllergyProfile = (p: string): boolean => ALLERGY_PROFILES.has(p as DietProfile) || p === "allergy_other" || p === "gluten_free";
