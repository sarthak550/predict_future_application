-- S54: Open Groups foundation (Pillar B community structure)
--
-- Adds GroupVisibility enum, new fields on Group (visibility, category, memberCap, coverImageUrl)
-- and ban tombstone fields on GroupMembership (bannedAt, banReason).
--
-- Migration safety:
--   - All new columns are nullable or have defaults; zero existing rows are harmed.
--   - Existing Group rows receive visibility = 'INVITE_ONLY' via DEFAULT — preserving existing behavior.
--   - Existing GroupMembership rows receive bannedAt = NULL (no ban) by default.

-- 1. Create the GroupVisibility enum (S55 will add REQUEST_TO_JOIN as the third value)
CREATE TYPE "GroupVisibility" AS ENUM ('INVITE_ONLY', 'OPEN');

-- 2. Add new columns to Group
ALTER TABLE "Group"
  ADD COLUMN "visibility"    "GroupVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
  ADD COLUMN "category"      "MarketCategory",
  ADD COLUMN "memberCap"     INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN "coverImageUrl" TEXT;

-- 3. Add ban tombstone columns to GroupMembership
ALTER TABLE "GroupMembership"
  ADD COLUMN "bannedAt"   TIMESTAMP(3),
  ADD COLUMN "banReason"  TEXT;

-- 4. Index on (visibility, createdAt) for the discover query ORDER BY / filter
CREATE INDEX "Group_visibility_createdAt_idx" ON "Group" ("visibility", "createdAt");
