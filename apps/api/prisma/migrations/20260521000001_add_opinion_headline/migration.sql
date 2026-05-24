-- AddColumn: headline to ExpertOpinion (S35-T2)
-- Server-generated 4-6 word headline for the Today's Big Call hero card.
-- Nullable: backfilled via apps/api/scripts/backfill-opinion-headlines.ts
ALTER TABLE "ExpertOpinion" ADD COLUMN IF NOT EXISTS "headline" TEXT;
