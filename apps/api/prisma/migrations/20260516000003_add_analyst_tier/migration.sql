-- CreateEnum
CREATE TYPE "AnalystTier" AS ENUM ('ROOKIE', 'ANALYST', 'SENIOR_ANALYST', 'CHIEF_ANALYST');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "analystTier" "AnalystTier" NOT NULL DEFAULT 'ROOKIE';
