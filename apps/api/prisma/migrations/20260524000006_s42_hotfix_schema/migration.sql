-- Migration: s42_hotfix_schema
-- Covers S42-T1, S42-T3, S42-T6, S42-T8 in one atomic migration.
--
-- 1. T1: Add WalletTransaction.multiChoicePositionId column + FK + unique index.
-- 2. T3: Drop COALESCE-based ExpertOpinion unique index, recreate as plain index to match schema.prisma.
-- 3. T6: Add Market.externalLastSyncedAt column + backfill from updatedAt for Manifold markets.
-- 4. T8: Add User.referralBonusCreditedAt column.

-- ─────────────────────────────────────────────────────────────
-- T1: WalletTransaction multiChoicePositionId
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "WalletTransaction"
  ADD COLUMN IF NOT EXISTS "multiChoicePositionId" TEXT;

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_multiChoicePositionId_fkey"
  FOREIGN KEY ("multiChoicePositionId")
  REFERENCES "MultiChoicePosition"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Unique index matching @@unique([walletId, marketId, type, multiChoicePositionId])
-- NULLs are distinct in PostgreSQL so binary-market rows (multiChoicePositionId IS NULL) will not
-- collide with one another under this index — they remain governed by the existing positionId index.
CREATE UNIQUE INDEX IF NOT EXISTS "WalletTransaction_walletId_marketId_type_multiChoicePositionId_key"
  ON "WalletTransaction" ("walletId", "marketId", "type", "multiChoicePositionId");

-- ─────────────────────────────────────────────────────────────
-- T3: ExpertOpinion unique index — drop COALESCE functional index, recreate plain
-- ─────────────────────────────────────────────────────────────

-- Drop the COALESCE-based functional index created in migration s40.
DROP INDEX IF EXISTS "ExpertOpinion_expertId_storyId_quoteHash_key";

-- Recreate as a plain unique index that exactly matches @@unique([expertId, storyId, quoteHash]).
-- With the plain index, two rows with the same expertId+quoteHash but storyId IS NULL are considered
-- distinct by PostgreSQL (NULLs are never equal), which is the correct semantic for cluster-only opinions.
CREATE UNIQUE INDEX "ExpertOpinion_expertId_storyId_quoteHash_key"
  ON "ExpertOpinion" ("expertId", "storyId", "quoteHash");

-- ─────────────────────────────────────────────────────────────
-- T6: Market.externalLastSyncedAt
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "Market"
  ADD COLUMN IF NOT EXISTS "externalLastSyncedAt" TIMESTAMP(3);

-- Backfill: set externalLastSyncedAt = updatedAt for all existing Manifold markets so they are
-- not all queued for re-sync on the first cron run after deploy. Markets updated more than 6 hours
-- ago will naturally re-enter the sync batch window.
UPDATE "Market"
SET "externalLastSyncedAt" = "updatedAt"
WHERE "originPlatform" = 'manifold';

-- ─────────────────────────────────────────────────────────────
-- T8: User.referralBonusCreditedAt
-- ─────────────────────────────────────────────────────────────

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "referralBonusCreditedAt" TIMESTAMP(3);

-- Backfill: mark any user who already has a REFERRAL_BONUS_REFEREE transaction as credited, so
-- the new guard doesn't accidentally re-credit them on their next position.
UPDATE "User" u
SET "referralBonusCreditedAt" = NOW()
WHERE EXISTS (
  SELECT 1
  FROM "WalletTransaction" wt
  JOIN "Wallet" w ON w."id" = wt."walletId"
  WHERE w."userId" = u."id"
    AND wt."type" = 'REFERRAL_BONUS_REFEREE'
);
