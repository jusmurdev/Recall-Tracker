-- Recall: package codes and remedy text
ALTER TABLE "Recall" ADD COLUMN "codeInfo" TEXT, ADD COLUMN "remedy" TEXT;

-- User: notification preferences
ALTER TABLE "User"
  ADD COLUMN "pushMinSeverity" "RecallSeverity" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "mutedCategories" "RecallCategory"[] DEFAULT ARRAY[]::"RecallCategory"[],
  ADD COLUMN "quietHoursStart" INTEGER,
  ADD COLUMN "quietHoursEnd" INTEGER,
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "digestMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "digestHour" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "lastDigestAt" TIMESTAMP(3);

-- WatchItem: category subscriptions
ALTER TYPE "WatchItemKind" ADD VALUE 'category';
ALTER TABLE "WatchItem" ADD COLUMN "minSeverity" "RecallSeverity";

-- Alert: dismiss / resolve
ALTER TABLE "Alert"
  ADD COLUMN "dismissedAt" TIMESTAMP(3),
  ADD COLUMN "dismissReason" TEXT,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedAction" TEXT;
