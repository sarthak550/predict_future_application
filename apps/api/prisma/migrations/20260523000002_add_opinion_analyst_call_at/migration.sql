-- AddColumn: analystCallAt to ExpertOpinion
-- When the analyst actually made the call (extracted from article text), distinct from
-- publishedAt which is the article's publication timestamp. Nullable — existing rows
-- and articles that don't state a separate call date fall back to publishedAt downstream.
ALTER TABLE "ExpertOpinion" ADD COLUMN IF NOT EXISTS "analystCallAt" TIMESTAMP(3);
