-- Migration: s40_expert_opinion_unique_position_portfolio_index
-- 1. Add quoteHash column to ExpertOpinion
-- 2. Backfill quoteHash via pgcrypto SHA-256 (enable extension if needed)
-- 3. Deduplicate any existing rows that share (expertId, storyId, computed-hash) — keep earliest
-- 4. Apply @@unique([expertId, storyId, quoteHash])
-- 5. Add @@index([userId, settledAt DESC]) on MarketPosition

-- Enable pgcrypto so we can compute SHA-256 inline
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Step 1: Add quoteHash column
ALTER TABLE "ExpertOpinion" ADD COLUMN IF NOT EXISTS "quoteHash" TEXT NOT NULL DEFAULT '';

-- Step 2: Backfill hash for all existing rows
UPDATE "ExpertOpinion"
SET "quoteHash" = encode(digest(lower(trim("quote")), 'sha256'), 'hex');

-- Step 3: Deduplicate rows sharing (expertId, storyId, quoteHash) — keep the earliest by createdAt
DELETE FROM "ExpertOpinion"
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "expertId", COALESCE("storyId", ''), "quoteHash"
        ORDER BY "createdAt" ASC
      ) AS rn
    FROM "ExpertOpinion"
  ) ranked
  WHERE rn > 1
);

-- Step 4: Unique constraint on (expertId, storyId, quoteHash)
CREATE UNIQUE INDEX IF NOT EXISTS "ExpertOpinion_expertId_storyId_quoteHash_key"
  ON "ExpertOpinion" ("expertId", COALESCE("storyId", ''), "quoteHash");

-- Step 5: Index on MarketPosition (userId, settledAt DESC) for portfolio queries
CREATE INDEX IF NOT EXISTS "MarketPosition_userId_settledAt_idx"
  ON "MarketPosition" ("userId", "settledAt" DESC);
