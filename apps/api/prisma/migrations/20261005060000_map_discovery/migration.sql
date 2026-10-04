ALTER TABLE "RestaurantProfile" ADD COLUMN "address" TEXT;
CREATE TABLE "DiscoveryCell" (
    "key" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "venues" INTEGER NOT NULL,
    CONSTRAINT "DiscoveryCell_pkey" PRIMARY KEY ("key")
);
