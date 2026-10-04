-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('pending', 'researching', 'ready', 'failed');

-- CreateTable
CREATE TABLE "RestaurantProfile" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "website" TEXT,
    "researchStatus" "ResearchStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "supplierTerms" TEXT[],
    "researchJson" JSONB,
    "researchedAt" TIMESTAMP(3),
    "researchError" TEXT,
    "researchCount" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "lastRequestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantProfile_key_key" ON "RestaurantProfile"("key");
CREATE INDEX "RestaurantProfile_researchStatus_researchedAt_idx" ON "RestaurantProfile"("researchStatus", "researchedAt");

-- AlterTable
ALTER TABLE "WatchItem" ADD COLUMN "restaurantProfileId" TEXT;
CREATE INDEX "WatchItem_restaurantProfileId_idx" ON "WatchItem"("restaurantProfileId");
ALTER TABLE "WatchItem" ADD CONSTRAINT "WatchItem_restaurantProfileId_fkey" FOREIGN KEY ("restaurantProfileId") REFERENCES "RestaurantProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
