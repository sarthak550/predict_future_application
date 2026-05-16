-- AlterTable: add suppressedAt to ExpertOpinion for admin suppress action
ALTER TABLE "ExpertOpinion" ADD COLUMN "suppressedAt" TIMESTAMP(3);
