/**
 * One vocabulary for turning product text into match terms, shared by the label scanner, the
 * receipt parser and the watchlist. Both scan paths must agree on what "Prairie Paws dog food"
 * means, otherwise the same product gets two verdicts.
 *
 * Terms carry an implicit weight (see `termWeight`): a brand-like word or a multi-word phrase
 * says a lot; a generic word like "milk" or "food" on its own says almost nothing, because
 * every dairy recall mentions milk.
 */

/** Words that name a kind of product rather than a product. Never a match on their own. */
export const GENERIC_WORDS = new Set([
  // staples
  "food", "foods", "drink", "drinks", "beverage", "snack", "snacks", "meal", "meals", "mix", "blend", "kit",
  "milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "eggs", "egg", "dairy",
  "bread", "bagel", "bagels", "roll", "rolls", "bun", "buns", "tortilla", "tortillas", "cracker", "crackers", "cookie", "cookies", "cake", "cakes", "pie", "muffin", "muffins", "pastry", "donut", "donuts",
  "cereal", "oats", "oatmeal", "granola", "flour", "rice", "pasta", "noodle", "noodles", "beans", "lentils", "quinoa",
  "chicken", "beef", "pork", "turkey", "ham", "bacon", "sausage", "sausages", "steak", "ground", "meat", "meats", "deli", "hot", "dogs", "jerky", "lamb",
  "fish", "salmon", "tuna", "shrimp", "seafood", "crab",
  "fruit", "fruits", "vegetable", "vegetables", "veggie", "veggies", "salad", "salads", "greens", "lettuce", "spinach", "kale", "tomato", "tomatoes", "potato", "potatoes", "onion", "onions", "pepper", "peppers", "carrot", "carrots", "apple", "apples", "banana", "bananas", "berries", "berry", "strawberry", "strawberries", "grapes", "melon", "orange", "oranges", "lemon", "lime", "avocado", "mushroom", "mushrooms", "cucumber", "cucumbers", "corn", "peas", "broccoli", "celery",
  "juice", "water", "soda", "coffee", "tea", "wine", "beer", "smoothie", "lemonade",
  "sauce", "salsa", "dip", "dressing", "ketchup", "mustard", "mayo", "mayonnaise", "syrup", "honey", "jam", "jelly", "spread", "oil", "vinegar", "soup", "broth", "stock", "seasoning", "spice", "spices", "salt", "sugar",
  "chocolate", "candy", "candies", "gum", "mints", "chips", "pretzels", "popcorn", "nuts", "nut", "peanuts", "peanut", "almonds", "almond", "cashews", "cashew", "walnut", "walnuts", "pecan", "pecans", "pistachio", "hazelnut", "coconut", "seeds", "trail", "bar", "bars", "protein",
  "strawberry", "mango", "pineapple", "cherry", "cherries", "peach", "peaches", "pear", "pears", "plum", "grape", "cranberry", "blueberry", "blueberries", "raspberry", "garlic", "ginger", "basil", "cinnamon", "caramel", "fudge", "mint", "maple", "sea", "kosher", "halal",
  "ice", "frozen", "fresh", "organic", "natural", "whole", "sliced", "diced", "chopped", "raw", "cooked", "roasted", "smoked", "baked", "fried", "dried", "canned", "instant", "ready",
  "creamy", "crunchy", "chunky", "smooth", "spicy", "sweet", "mild", "original", "classic", "light", "lite", "diet", "zero", "regular", "plain", "vanilla", "white", "brown", "dark", "red", "green", "yellow", "black", "blue",
  "low", "fat", "free", "reduced", "unsalted", "salted", "sodium", "lactose", "gluten", "sugarfree",
  // sizes / packaging
  "pack", "pk", "count", "ct", "pcs", "piece", "pieces", "jar", "jars", "can", "cans", "bottle", "bottles", "box", "boxes", "bag", "bags", "tub", "cup", "cups", "pouch", "carton", "case", "bundle", "family", "value", "size", "large", "small", "medium", "mini", "jumbo", "giant", "king", "party",
  "oz", "lb", "lbs", "gallon", "gal", "quart", "pint", "liter", "litre", "ml",
  // other product nouns
  "dog", "cat", "puppy", "kitten", "pet", "treats", "treat", "chews", "chew", "kibble", "formula", "infant", "baby", "toddler", "kids", "adult", "senior",
  "vitamin", "vitamins", "supplement", "supplements", "capsules", "capsule", "tablets", "tablet", "gummies", "gummy", "softgels", "powder",
  "shampoo", "conditioner", "lotion", "soap", "toothpaste", "sunscreen", "deodorant", "wipes", "diapers", "tissue", "towels",
  "mug", "mugs", "tumbler", "cup", "blender", "heater", "charger", "battery", "batteries", "toy", "toys", "stroller", "crib", "helmet", "bike", "chair", "lamp", "candle", "candles",
  "product", "products", "item", "items", "brand", "store", "new", "best", "premium", "select", "signature", "choice", "quality", "farm", "farms", "fresh", "home", "house", "kitchen", "garden", "market", "pantry", "nature", "natures", "simply", "great", "good", "real",
]);

const NUMERIC = /^\d+(\.\d+)?$/;

export function isGeneric(word: string): boolean {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return !w || NUMERIC.test(w) || GENERIC_WORDS.has(w);
}

/** True when every word in the term is generic ("dog food", "whole milk"). */
export function isGenericTerm(term: string): boolean {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(isGeneric);
}

/**
 * How much a matched term should count toward a match. Phrases and distinctive words carry the
 * signal; generic words barely register, so "milk" alone can never flag a product.
 */
export function termWeight(term: string): number {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  if (words.length === 1) return isGeneric(words[0]!) ? 0.25 : 1;
  const distinctive = words.filter((w) => !isGeneric(w)).length;
  if (distinctive === 0) return 0.6; // "dog food", "peanut butter"
  return Math.min(3, 1.5 + 0.75 * distinctive);
}

export interface ProductTermsOptions {
  /** Brand already identified (receipt store brand, OCR brand line); gets its own term. */
  brand?: string | null;
  max?: number;
}

/**
 * Product text ("Prairie Paws dog food", "kroger creamy peanut butter 16 oz") → ranked terms.
 * Produces: the whole phrase when short, the brand, adjacent word pairs, and distinctive single
 * words. Generic single words are never emitted on their own.
 */
export function productTerms(text: string, opts: ProductTermsOptions = {}): string[] {
  const max = opts.max ?? 8;
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'&.\- ]/gu, " ")
    .replace(/\b(\d+(?:\.\d+)?)\s*(oz|z|lb|lbs|fl ?oz|ml|l|g|kg|ct|pk|gal|qt|pt)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter((w) => w.length >= 2 && !NUMERIC.test(w) && !STOP.has(w));
  const out: string[] = [];
  const push = (t: string) => {
    const term = t.trim();
    if (term.length < 2 || out.includes(term)) return;
    out.push(term);
  };
  const brand = opts.brand?.toLowerCase().trim();
  if (brand && brand.length >= 2 && !isGenericTerm(brand)) push(brand);
  // Whole phrase first: an exact product name is the strongest evidence we can have.
  if (words.length >= 2 && words.length <= 5) push(words.join(" "));
  // Distinctive words: brand-like tokens the text happens to contain.
  for (const w of words) if (w.length >= 3 && !isGeneric(w)) push(w);
  // Adjacent pairs: "peanut butter", "prairie paws", "dog food".
  for (let i = 0; i + 1 < words.length; i += 1) push(`${words[i]} ${words[i + 1]}`);
  return out.slice(0, max);
}

const STOP = new Set(["the", "and", "with", "of", "for", "a", "an", "in", "on", "to", "by", "per", "or", "w", "n", "it", "at", "from", "each", "ea", "qty", "x"]);

/** Display-friendly list of terms for an explanation ("prairie paws, dog food"). */
export function describeTerms(terms: string[], limit = 3): string {
  return terms.slice(0, limit).join(", ");
}
