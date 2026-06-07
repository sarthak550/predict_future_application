-- S49-T1: Add composite index on ExpertOpinion(expertId, resolutionStatus, resolvedAt)
-- to support efficient weekly hit-rate aggregation in GET /api/experts/top-weekly.
-- The existing @@index([expertId, publishedAt]) does not cover resolutionStatus/resolvedAt.
CREATE INDEX "ExpertOpinion_expertId_resolutionStatus_resolvedAt_idx"
  ON "ExpertOpinion" ("expertId", "resolutionStatus", "resolvedAt");
