# Dietary profiles

A free, deterministic feature: people tell the app what they avoid (allergies, gluten, halal,
kosher) and get alerted when a recall notice mentions it, even if the product was never on their
watchlist. The same dictionary runs on labels and receipts they scan ("heads up for your diet").
No AI is required; an optional premium step can classify ambiguous ingredient words.

## What a user can turn on

| Profile | Stored as | What fires |
|---|---|---|
| Milk, egg, fish, shellfish, tree nut, peanut, wheat, soy, sesame allergy | `allergy_<name>` | Any non-negated mention of the allergen or a hidden source (casein, albumin, semolina…) |
| Other allergen (free text, up to 10) | `otherAllergens[]` | The typed word, matched like a dictionary term |
| Gluten-free | `gluten_free` | Wheat, barley, rye, malt, brewer's yeast, spelt, farro, seitan, "contains gluten"… |
| Halal diet | `halal` | Haram ingredients named in the text: pork and derivatives, lard, alcohol and spirits, carmine/cochineal, "non-halal". Labels "Halal" and "Haram" both appear in the UI copy; they are one preference. |
| Kosher | `kosher` | (a) explicit non-kosher ingredients (pork, shellfish, lard…), (b) a named kosher certifier or mark (Orthodox Union, OU-D, OK, Star-K, KOF-K, cRc, "kosher certified"), (c) meat-and-dairy cross-contact wording |
| Vegan | `vegan` | Animal-derived ingredients named in the text: meat, poultry, fish and seafood, dairy, egg, honey, gelatin, lard, carmine, isinglass, shellac, L-cysteine, "non-vegan". Like allergens, a plainly animal product ("Chicken Breast") recalled for another reason is not an alert; a mislabeled "vegan" product that contains egg is. No severity floor (not a health risk). |

Selections live on `User.dietProfiles` and `User.otherAllergens` (plain string arrays), are
edited through `PATCH /v1/me/preferences`, returned by `GET /v1/me` as `diet`, and deleted with
the account (`DELETE /v1/me`).

## The dictionary

`apps/api/src/diet/dictionary.ts`, `DICTIONARY_VERSION = 2`. One entry per profile:

- `terms`: a mention means the thing is present or suspected. Includes synonyms, derived
  ingredients and hidden sources.
- `ambiguous`: words that only sometimes mean this ("gelatin", "natural flavors", "enzymes",
  "lecithin", "flour"). Shown as "might contain", never promoted to a certain hit by the matcher.

Matching rules (`apps/api/src/diet/match.ts`):

- Case-insensitive, word boundaries (`egg` does not match `eggplant`, `nut` does not match
  `nutmeg`), simple plurals (`peanut` matches `peanuts`, `anchovy` matches `anchovies`),
  spaces or hyphens between the words of a multi-word term.
- Negations suppress a hit: `peanut-free`, `free from gluten and wheat`, `does not contain milk`,
  `contains no soy`, `non-dairy`. Short cues (`no`, `non`, `zero`) must touch the term so
  `nonfat dry milk` still counts as milk.
- Undeclared cues within the sentence (`undeclared`, `not declared`, `not listed`, `mislabeled`,
  `may contain`, `cross-contact`, `presence of`…) make the hit kind `undeclared`, which outranks a
  negation: "labeled dairy-free but contains undeclared milk" is a milk hit.
- Recall fields are scanned in this order: `reason`, `summary`, `title`, `productDescription`,
  `codeInfo`. A hit in the reason or summary is about why it was recalled and scores higher.
- Scoring: undeclared allergen 0.95 (severity floor `high`), allergen mentioned in the reason
  0.8, kosher certifier or meat/dairy cross-contact 0.7, haram/non-kosher ingredient in the reason
  0.75, in the product description 0.5, ambiguous 0.3–0.4 (never an alert on its own).
- Allergen named only in the product itself ("Peanut Butter Cups" recalled for metal fragments)
  does not alert: nothing is hidden there. It does alert when the recall is about labeling. The
  same rule applies to the vegan profile.

Why recall over precision for allergies: a person with a peanut allergy would rather dismiss an
alert about "peanut oil" than miss one. Ambiguous words are the exception because flagging
"natural flavors" on every label would make the heads-up meaningless; allergy profiles hide
ambiguous hits on labels, halal, kosher and vegan show them because unspecified gelatin,
glycerin or flavors are exactly their question.

## How alerts flow

1. Ingestion upserts recalls and calls `matchRecalls()` for changed ones. After the watchlist
   pass, `matchRecallsForDiet()` scans each recall once against the whole dictionary to learn
   which profiles could fire, loads only users holding one of those profiles (or any free-text
   allergen), and creates one `Alert` per user with `reason = diet_match`, `dietProfile`,
   `dietKind` and `matchedPhrase`.
2. Push: an undeclared allergen for an allergic user is at least `high`, skips the daily digest
   and goes out at once; quiet hours still apply unless the recall is `critical`. The push title
   names the profile ("⚠️ Recall · Peanut allergy"), nothing else.
3. Changing the profile backfills the last 45 days (up to 25 alerts, marked pushed) so the
   change is visible immediately.
4. `GET /v1/recalls?diet=1` (signed in) narrows the feed to matching recalls and attaches
   `dietHit` to each item; the app's Browse tab shows it as "For my diet".
5. `POST /v1/scan/match` returns `diet[]` for the label text and `POST /v1/scan/receipt` returns
   `dietFlags[]` per line.

## Extending the dictionary

1. Add the term to the right list in `dictionary.ts` (or to `ambiguous` if it only sometimes
   applies). Multi-word terms are fine; write them with spaces.
2. Add a positive and, where relevant, a negation case to `dictionary.test.ts`.
3. Bump `DICTIONARY_VERSION`.
4. Run `npm test -w @recall/api`.

For a new profile: add it to `DietProfile` and `DIET_PROFILE_LABEL` in `packages/shared`, add an
entry in `ENTRIES`, add the toggle or chip in `apps/mobile/src/lib/diet.ts`, and extend
`explain()` in `match.ts` if the wording should differ.

## Limits and honesty

- Recall data never says a product is halal, haram or kosher. The app says "mentions pork-derived
  gelatin" or "names a kosher-certified product", never "not halal". The "About diet alerts"
  screen in the app states this and tells allergy sufferers to check the package.
- Matching sees only the words in the notice or on the label. An unnamed ingredient is invisible.
- Diet selections are sensitive. They are stored as plain lists, excluded from request logs (the
  API never logs bodies), never sent to third-party AI providers, and removed by account deletion.
  The optional premium classifier (`apps/api/src/diet/aiClassify.ts`) receives the label text and
  the ambiguous words only; its answer can upgrade an ambiguous hit but never remove a
  deterministic one.

## Demo data

`npm run seed:demo -w @recall/api` creates seven recalls (undeclared milk, undeclared peanuts, a
gluten/wheat mislabel, pork gelatin, an alcohol-containing sauce, a kosher-certified product, a
mislabeled vegan mayo containing egg) and gives the demo user a profile that matches all of them.
