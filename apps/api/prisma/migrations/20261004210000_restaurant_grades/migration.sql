-- RestaurantProfile: health inspection grade
ALTER TABLE "RestaurantProfile"
  ADD COLUMN "gradeSource" TEXT,
  ADD COLUMN "gradeExternalId" TEXT,
  ADD COLUMN "currentGrade" TEXT,
  ADD COLUMN "currentScore" INTEGER,
  ADD COLUMN "gradeScale" TEXT,
  ADD COLUMN "lastInspectedAt" TIMESTAMP(3),
  ADD COLUMN "gradeCheckedAt" TIMESTAMP(3),
  ADD COLUMN "gradeError" TEXT;
CREATE INDEX "RestaurantProfile_gradeCheckedAt_idx" ON "RestaurantProfile"("gradeCheckedAt");
CREATE INDEX "RestaurantProfile_name_idx" ON "RestaurantProfile"("name");
CREATE INDEX "RestaurantProfile_name_trgm_idx" ON "RestaurantProfile" USING GIN (lower(name) gin_trgm_ops);

-- RestaurantInspection
CREATE TABLE "RestaurantInspection" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL,
    "grade" TEXT,
    "score" INTEGER,
    "inspectionType" TEXT,
    "violations" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RestaurantInspection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RestaurantInspection_profileId_source_inspectedAt_key" ON "RestaurantInspection"("profileId", "source", "inspectedAt");
CREATE INDEX "RestaurantInspection_profileId_inspectedAt_idx" ON "RestaurantInspection"("profileId", "inspectedAt" DESC);
ALTER TABLE "RestaurantInspection" ADD CONSTRAINT "RestaurantInspection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RestaurantNotice
CREATE TABLE "RestaurantNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "pushedAt" TIMESTAMP(3),
    CONSTRAINT "RestaurantNotice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RestaurantNotice_userId_createdAt_idx" ON "RestaurantNotice"("userId", "createdAt" DESC);
CREATE INDEX "RestaurantNotice_profileId_kind_createdAt_idx" ON "RestaurantNotice"("profileId", "kind", "createdAt" DESC);
ALTER TABLE "RestaurantNotice" ADD CONSTRAINT "RestaurantNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RestaurantNotice" ADD CONSTRAINT "RestaurantNotice_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RestaurantProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AiUsage: system-initiated work has no user
ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL;
