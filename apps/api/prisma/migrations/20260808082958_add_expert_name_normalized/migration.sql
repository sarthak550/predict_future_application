-- AlterTable
ALTER TABLE "Expert" ADD COLUMN     "nameNormalized" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Expert_nameNormalized_idx" ON "Expert"("nameNormalized");
