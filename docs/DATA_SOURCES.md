# Data sources

All sources are public US government APIs with no authentication required. Only the
ingestion worker calls them; clients read from our database.

> Note on scope: the agency that regulates food recalls is the **FDA** (plus the USDA's FSIS
> for meat/poultry/eggs). The FCC regulates communications and publishes no recalls.

## FDA — openFDA Enforcement Reports

- Endpoints: `https://api.fda.gov/food/enforcement.json`, `/drug/enforcement.json`,
  `/device/enforcement.json`
- Docs: https://open.fda.gov/apis/food/enforcement/
- Auth: optional `api_key` (`OPENFDA_API_KEY`). 1,000 req/day without, 120,000 with.
- Query used: `search=report_date:[YYYYMMDD+TO+YYYYMMDD]&sort=report_date:asc&limit=100&skip=N`
- Empty result = HTTP 404 with `{"error":{"code":"NOT_FOUND"}}` (handled, not an error).
- Max `skip` is 25,000; our windows are days wide so this is never hit.
- Fields we use: `recall_number` (id), `classification` (Class I/II/III → severity),
  `status`, `product_type`, `recalling_firm`, `product_description`, `reason_for_recall`,
  `code_info`/`more_code_info` (UPCs, lots), `distribution_pattern` (states),
  `recall_initiation_date`, `report_date`.
- Category: `product_type` + description heuristics (supplement, cosmetic, pet food →
  `dietary_supplement`, `cosmetic`, `veterinary`).
- Updates: FDA republishes rows when status changes (Ongoing → Completed/Terminated). We
  detect via content hash and only re-alert on escalation or re-opening.

## USDA FSIS — Recalls and Public Health Alerts

- Endpoint: `https://www.fsis.usda.gov/fsis/api/recall/v/1`
- Docs: https://www.fsis.usda.gov/science-data/developer-resources/recall-api
- Returns the full recent list as a JSON array (`field_*` keys). Server-side filters are
  taxonomy-id based, so we filter client-side on `field_last_modified_date` /
  `field_recall_date`.
- Spanish translations share `field_recall_number`; rows with `langcode != "English"` are
  skipped.
- Severity: `field_recall_classification` (Class I/II/III) then `field_risk_level`
  (High/Medium/Low). Public Health Alerts with no class default to `high`.
- `field_recall_url` is relative; we prefix `https://www.fsis.usda.gov`.
- Company is parsed from the headline (`"<Company> Recalls …"`), falling back to
  `field_establishment`.

## CPSC — Consumer Product Safety Commission

- Endpoint: `https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=YYYY-MM-DD&RecallDateEnd=YYYY-MM-DD`
- Docs: https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information
- Rich structure: `Products[]`, `ProductUPCs[]`, `Hazards[]`, `Injuries[]`, `Retailers[]`,
  `Manufacturers[]`, `Images[]`.
- CPSC does not classify severity; we derive it: deaths → `critical`; burn/laceration/
  choking/fire/lead/CO → `high`; otherwise `low`.
- Always `consumer_product`, distribution `["US"]`.

## Normalised schema (`Recall`)

| Field | Meaning |
| --- | --- |
| `source`, `sourceId` | Unique key per source record |
| `severity` | `critical` (Class I), `high` (Class II), `low` (Class III), `unknown` |
| `category` | food, meat_poultry, dietary_supplement, cosmetic, drug, medical_device, veterinary, consumer_product, other |
| `status` | ongoing, completed, terminated, pending, unknown |
| `upcs[]` | 8–14 digit GTINs extracted from label text or structured fields |
| `brands[]` | Heuristic brand names (quoted names, "X brand") |
| `distributionStates[]` | Two-letter codes; `["US"]` for nationwide |
| `recallDate` / `publishedAt` | Firm initiation vs. agency publication |
| `searchVector` | Weighted tsvector (title/company A, product B, reason C, summary D) |
| `contentHash` | sha256 of the normalised fields for change detection |
| `raw` | Original payload |

## Politeness

- Cron cadence: FDA every 4h, FSIS every 2h, CPSC every 6h (configurable).
- 3-day overlap window per run to catch late edits; otherwise only new data is requested.
- Retries with exponential backoff and `Retry-After`; `concurrency: 1` per source.
- Descriptive `User-Agent`.

## Adding a source

1. Create `src/ingest/sources/<name>.ts` implementing `SourceAdapter`.
2. Record a fixture in `src/ingest/fixtures/<name>.json` and map its URL in `fixtureLoader.ts`.
3. Add the enum value to `RecallSource` in `packages/shared` and `prisma/schema.prisma`
   (migration), register in `sources/index.ts`, add a cron env var.
4. Write normalisation tests against the fixture.
