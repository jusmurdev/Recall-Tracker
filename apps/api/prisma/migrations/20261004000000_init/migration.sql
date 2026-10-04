-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "RecallSource" AS ENUM ('FDA', 'FSIS', 'CPSC');

-- CreateEnum
CREATE TYPE "RecallCategory" AS ENUM ('food', 'meat_poultry', 'dietary_supplement', 'cosmetic', 'drug', 'medical_device', 'veterinary', 'consumer_product', 'other');

-- CreateEnum
CREATE TYPE "RecallSeverity" AS ENUM ('critical', 'high', 'low', 'unknown');

-- CreateEnum
CREATE TYPE "RecallStatus" AS ENUM ('ongoing', 'completed', 'terminated', 'pending', 'unknown');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('free', 'premium');

-- CreateEnum
CREATE TYPE "WatchItemKind" AS ENUM ('product', 'upc', 'scan', 'restaurant');

-- CreateEnum
CREATE TYPE "MatchReason" AS ENUM ('upc_exact', 'brand_match', 'text_match', 'scan_text_match', 'restaurant_supplier', 'category_subscription');

-- CreateTable
CREATE TABLE "Recall" (
    "id" TEXT NOT NULL,
    "source" "RecallSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "productDescription" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "category" "RecallCategory" NOT NULL,
    "severity" "RecallSeverity" NOT NULL,
    "status" "RecallStatus" NOT NULL,
    "company" TEXT NOT NULL,
    "brands" TEXT[],
    "upcs" TEXT[],
    "distributionStates" TEXT[],
    "recallDate" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "url" TEXT,
    "imageUrls" TEXT[],
    "contentHash" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSyncState" (
    "source" "RecallSource" NOT NULL,
    "watermark" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SourceSyncState_pkey" PRIMARY KEY ("source")
);

-- CreateTable
CREATE TABLE "IngestRun" (
    "id" TEXT NOT NULL,
    "source" "RecallSource" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "ok" BOOLEAN,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "alertsCreated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "IngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL DEFAULT 'free',
    "premiumExpiresAt" TIMESTAMP(3),
    "subscriptionRef" TEXT,
    "homeState" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expoPushToken" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "invalidatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "WatchItemKind" NOT NULL,
    "label" TEXT NOT NULL,
    "terms" TEXT[],
    "upc" TEXT,
    "context" TEXT,
    "ocrText" TEXT,
    "categories" "RecallCategory"[] DEFAULT ARRAY[]::"RecallCategory"[],
    "restaurantName" TEXT,
    "restaurantCity" TEXT,
    "restaurantState" TEXT,
    "restaurantWebsite" TEXT,
    "importedFrom" TEXT,
    "researchSummary" TEXT,
    "researchUpdatedAt" TIMESTAMP(3),
    "researchJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recallId" TEXT NOT NULL,
    "watchItemId" TEXT,
    "reason" "MatchReason" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    "pushTicket" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mcpUrl" TEXT NOT NULL,
    "tokenCiphertext" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'never',
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recall_publishedAt_idx" ON "Recall"("publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Recall_category_publishedAt_idx" ON "Recall"("category", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Recall_severity_publishedAt_idx" ON "Recall"("severity", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "Recall_upcs_idx" ON "Recall" USING GIN ("upcs");

-- CreateIndex
CREATE INDEX "Recall_distributionStates_idx" ON "Recall" USING GIN ("distributionStates");

-- CreateIndex
CREATE INDEX "Recall_searchVector_idx" ON "Recall" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "Recall_source_sourceId_key" ON "Recall"("source", "sourceId");

-- CreateIndex
CREATE INDEX "IngestRun_source_startedAt_idx" ON "IngestRun"("source", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "User_installId_key" ON "User"("installId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tokenHash_key" ON "User"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_expoPushToken_key" ON "Device"("expoPushToken");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE INDEX "WatchItem_userId_idx" ON "WatchItem"("userId");

-- CreateIndex
CREATE INDEX "WatchItem_upc_idx" ON "WatchItem"("upc");

-- CreateIndex
CREATE INDEX "WatchItem_kind_idx" ON "WatchItem"("kind");

-- CreateIndex
CREATE INDEX "Alert_userId_createdAt_idx" ON "Alert"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_pushedAt_idx" ON "Alert"("pushedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_userId_recallId_key" ON "Alert"("userId", "recallId");

-- CreateIndex
CREATE INDEX "Connector_userId_idx" ON "Connector"("userId");

-- CreateIndex
CREATE INDEX "AiUsage_userId_createdAt_idx" ON "AiUsage"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_recallId_fkey" FOREIGN KEY ("recallId") REFERENCES "Recall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Full-text search: keep "searchVector" in sync with the text columns.
-- Title and company/brands weigh more than the long product description.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recall_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.company, '') || ' ' || coalesce(array_to_string(NEW.brands, ' '), '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW."productDescription", '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.reason, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER recall_search_vector_trg
BEFORE INSERT OR UPDATE OF title, company, brands, "productDescription", reason, summary ON "Recall"
FOR EACH ROW EXECUTE FUNCTION recall_search_vector_update();

-- Trigram index for fuzzy brand matching in the matching engine.
CREATE INDEX "Recall_title_trgm_idx" ON "Recall" USING GIN (lower(title) gin_trgm_ops);
CREATE INDEX "Recall_company_trgm_idx" ON "Recall" USING GIN (lower(company) gin_trgm_ops);
