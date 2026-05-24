-- AlterTable
ALTER TABLE "ExpertOpinionVote" ADD COLUMN "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ExpertOpinionVote_userId_lockedAt_idx" ON "ExpertOpinionVote"("userId", "lockedAt");
