-- CreateEnum
CREATE TYPE "ExpertOpinionPollType" AS ENUM ('IMPLICATION', 'RETROSPECTIVE');

-- CreateTable
CREATE TABLE "ExpertOpinionVote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opinionId" TEXT NOT NULL,
    "pollType" "ExpertOpinionPollType" NOT NULL,
    "choice" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertOpinionVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertOpinionVote_userId_opinionId_pollType_key" ON "ExpertOpinionVote"("userId", "opinionId", "pollType");

-- CreateIndex
CREATE INDEX "ExpertOpinionVote_opinionId_pollType_idx" ON "ExpertOpinionVote"("opinionId", "pollType");

-- AddForeignKey
ALTER TABLE "ExpertOpinionVote" ADD CONSTRAINT "ExpertOpinionVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertOpinionVote" ADD CONSTRAINT "ExpertOpinionVote_opinionId_fkey" FOREIGN KEY ("opinionId") REFERENCES "ExpertOpinion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
