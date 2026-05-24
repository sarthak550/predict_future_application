-- S38-T6: Wallet balance non-negative CHECK constraint (defense-in-depth against double-spend)
ALTER TABLE "Wallet" ADD CONSTRAINT wallet_balance_nonnegative CHECK (balance >= 0);

-- S38-T10: BigCallTap idempotency table — one tap per (userId, marketId, IST calendar day)
CREATE TABLE "BigCallTap" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "marketId"  TEXT NOT NULL,
    "dateIST"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BigCallTap_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BigCallTap_userId_marketId_dateIST_key"
    ON "BigCallTap"("userId", "marketId", "dateIST");

CREATE INDEX "BigCallTap_marketId_dateIST_idx"
    ON "BigCallTap"("marketId", "dateIST");

-- S38-T11: ExpertOpinion retry attempt counters (preprocessAttempts, resolutionAttempts)
ALTER TABLE "ExpertOpinion"
    ADD COLUMN "preprocessAttempts"      INTEGER   NOT NULL DEFAULT 0,
    ADD COLUMN "lastPreprocessAttemptAt" TIMESTAMP(3),
    ADD COLUMN "resolutionAttempts"      INTEGER   NOT NULL DEFAULT 0,
    ADD COLUMN "lastResolutionAttemptAt" TIMESTAMP(3);

-- S38-T12: WalletTransaction unique idempotency index
-- Postgres allows multiple NULLs in a unique index, so rows without positionId/marketId won't collide.
-- Pre-condition check: SELECT walletId, marketId, type, positionId, COUNT(*) FROM "WalletTransaction"
--   GROUP BY 1,2,3,4 HAVING COUNT(*) > 1;
-- Result: 0 duplicate rows found in dev DB — constraint applied cleanly without a dedupe step.
CREATE UNIQUE INDEX "WalletTransaction_walletId_marketId_type_positionId_key"
    ON "WalletTransaction"("walletId", "marketId", "type", "positionId");
