-- S39 Cron Idempotency
-- T8: WeeklyDigestRun guard, Market.flagshipReminderSentAt
-- T9: ExpertOpinion.notifiedAt for notification sweep

-- AlterTable: add flagship reminder idempotency field to Market
ALTER TABLE "Market" ADD COLUMN "flagshipReminderSentAt" TIMESTAMP(3);

-- AlterTable: add notification-sent marker to ExpertOpinion
ALTER TABLE "ExpertOpinion" ADD COLUMN "notifiedAt" TIMESTAMP(3);

-- CreateTable: weekly digest run guard
CREATE TABLE "WeeklyDigestRun" (
    "id" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "userCount" INTEGER NOT NULL DEFAULT 0,
    "pushCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WeeklyDigestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique weekKey so P2002 fires on double-insert
CREATE UNIQUE INDEX "WeeklyDigestRun_weekKey_key" ON "WeeklyDigestRun"("weekKey");
