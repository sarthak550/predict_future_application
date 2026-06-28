-- S62: Add lightweight Poll system (PollStatus enum, Poll, PollOption, PollVote models)
-- and additive UserStat fields for poll accuracy tracking.
-- Applied via `prisma db push` because migrate dev cannot replay old migrations
-- against the shadow database (MarketCategory enum missing in shadow).

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED', 'RESOLVED');

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "category" "MarketCategory" NOT NULL,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "closeAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "winningOptionId" TEXT,
    "structuredData" JSONB,
    "packId" TEXT,
    "eventAt" TIMESTAMP(3),
    "storyId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isCorrect" BOOLEAN,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Poll_storyId_key" ON "Poll"("storyId");

-- CreateIndex
CREATE INDEX "Poll_status_closeAt_idx" ON "Poll"("status", "closeAt");

-- CreateIndex
CREATE INDEX "Poll_packId_idx" ON "Poll"("packId");

-- CreateIndex
CREATE INDEX "Poll_createdById_createdAt_idx" ON "Poll"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "Poll_category_status_idx" ON "Poll"("category", "status");

-- CreateIndex
CREATE INDEX "PollOption_pollId_idx" ON "PollOption"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_userId_key" ON "PollVote"("pollId", "userId");

-- CreateIndex
CREATE INDEX "PollVote_pollId_idx" ON "PollVote"("pollId");

-- CreateIndex
CREATE INDEX "PollVote_userId_idx" ON "PollVote"("userId");

-- CreateIndex
CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (additive UserStat columns with defaults — non-destructive)
ALTER TABLE "UserStat" ADD COLUMN "totalPollPredictions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserStat" ADD COLUMN "pollAccuracyScore" DOUBLE PRECISION NOT NULL DEFAULT 0;
