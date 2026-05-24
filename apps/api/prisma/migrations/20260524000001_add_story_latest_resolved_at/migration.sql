-- AddColumn: denormalized max(opinion.resolvedAt) per story so the
-- "Resolved only" feed can ORDER BY without a nested aggregate.
ALTER TABLE "Story" ADD COLUMN IF NOT EXISTS "latestResolvedAt" TIMESTAMP(3);

-- Index for the resolved-feed sort + cursor.
CREATE INDEX IF NOT EXISTS "Story_latestResolvedAt_idx" ON "Story" ("latestResolvedAt" DESC);

-- Backfill from existing opinion data.
UPDATE "Story" s
SET "latestResolvedAt" = sub.max_resolved
FROM (
  SELECT "storyId", MAX("resolvedAt") AS max_resolved
  FROM "ExpertOpinion"
  WHERE "resolvedAt" IS NOT NULL AND "storyId" IS NOT NULL AND "suppressedAt" IS NULL
  GROUP BY "storyId"
) AS sub
WHERE s.id = sub."storyId";
