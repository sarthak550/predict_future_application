-- CreateEnum
CREATE TYPE "ExpertEntityKind" AS ENUM ('HUMAN', 'FIRM');

-- AlterTable
ALTER TABLE "Expert" ADD COLUMN     "entityKind" "ExpertEntityKind" NOT NULL DEFAULT 'HUMAN';

-- CreateIndex
CREATE INDEX "Expert_entityKind_idx" ON "Expert"("entityKind");

