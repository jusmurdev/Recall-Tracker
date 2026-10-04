-- Dietary profiles: per-user selections plus free-text allergens. Sensitive; stored as plain lists only.
ALTER TABLE "User" ADD COLUMN "dietProfiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "otherAllergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- New alert reason for recalls that match a dietary profile.
ALTER TYPE "MatchReason" ADD VALUE IF NOT EXISTS 'diet_match';

ALTER TABLE "Alert" ADD COLUMN "dietProfile" TEXT;
ALTER TABLE "Alert" ADD COLUMN "dietKind" TEXT;
ALTER TABLE "Alert" ADD COLUMN "matchedPhrase" TEXT;
