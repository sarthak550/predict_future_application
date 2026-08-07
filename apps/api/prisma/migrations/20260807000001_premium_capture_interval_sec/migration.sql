-- AlterTable
ALTER TABLE "OptionPremiumSnapshot" ADD COLUMN     "captureIntervalSec" INTEGER NOT NULL DEFAULT 300;

-- CreateIndex
CREATE INDEX "OptionPremiumSnapshot_captureIntervalSec_capturedAt_idx" ON "OptionPremiumSnapshot"("captureIntervalSec", "capturedAt");
