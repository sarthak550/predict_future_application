-- S41 schema polish
-- 1. Coerce any non-enum LeaderboardSnapshot.category values to NULL before type change
UPDATE "LeaderboardSnapshot"
SET "category" = NULL
WHERE "category" IS NOT NULL
  AND "category" NOT IN (
    'GENERAL','SPORTS','BUSINESS','TECH','WEATHER','ENTERTAINMENT','PRODUCT','COMPANY','FINANCE'
  );

-- 2. Change LeaderboardSnapshot.category from String? to MarketCategory?
ALTER TABLE "LeaderboardSnapshot"
  ALTER COLUMN "category" TYPE "MarketCategory"
  USING "category"::"MarketCategory";

-- 3. Add onDelete: SetNull for WalletTransaction -> Market FK
ALTER TABLE "WalletTransaction"
  DROP CONSTRAINT IF EXISTS "WalletTransaction_marketId_fkey";

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_marketId_fkey"
  FOREIGN KEY ("marketId")
  REFERENCES "Market"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- 4. Add onDelete: SetNull for WalletTransaction -> MarketPosition FK
ALTER TABLE "WalletTransaction"
  DROP CONSTRAINT IF EXISTS "WalletTransaction_positionId_fkey";

ALTER TABLE "WalletTransaction"
  ADD CONSTRAINT "WalletTransaction_positionId_fkey"
  FOREIGN KEY ("positionId")
  REFERENCES "MarketPosition"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
