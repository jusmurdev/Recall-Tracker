-- AlterTable: user location (state only, no coordinates)
ALTER TABLE "User" ADD COLUMN "lastKnownState" TEXT,
                   ADD COLUMN "lastLocationAt" TIMESTAMP(3);

-- AlterTable: restaurant coordinates for nearby lookups and geofences
ALTER TABLE "RestaurantProfile" ADD COLUMN "latitude" DOUBLE PRECISION,
                                ADD COLUMN "longitude" DOUBLE PRECISION;
CREATE INDEX "RestaurantProfile_latitude_longitude_idx" ON "RestaurantProfile"("latitude", "longitude");
