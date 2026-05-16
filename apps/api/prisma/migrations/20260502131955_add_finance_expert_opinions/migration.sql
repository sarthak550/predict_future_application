-- CreateEnum
CREATE TYPE "OpinionDirection" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "OpinionResolutionStatus" AS ENUM ('PENDING', 'RESOLVED_HIT', 'RESOLVED_MISS', 'NOT_GRADED');

-- AlterEnum
ALTER TYPE "MarketCategory" ADD VALUE 'FINANCE';

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "tipranksUrl" TEXT,
    "linkedinUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertOpinion" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "storyId" TEXT,
    "marketId" TEXT,
    "quote" TEXT NOT NULL,
    "direction" "OpinionDirection" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "resolutionStatus" "OpinionResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expert_name_organization_key" ON "Expert"("name", "organization");

-- CreateIndex
CREATE INDEX "ExpertOpinion_expertId_publishedAt_idx" ON "ExpertOpinion"("expertId", "publishedAt");

-- AddForeignKey
ALTER TABLE "ExpertOpinion" ADD CONSTRAINT "ExpertOpinion_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertOpinion" ADD CONSTRAINT "ExpertOpinion_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;
