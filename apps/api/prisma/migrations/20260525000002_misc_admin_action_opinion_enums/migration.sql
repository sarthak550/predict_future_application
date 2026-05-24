-- Misc: add AdminActionType enum values for expert-opinion admin actions.
--
-- The admin/expert-opinions/[id]/{resolve,suppress} routes previously logged
-- with type=RESOLVE_MARKET (which is for binary/multi-choice market resolution,
-- not opinion grading) or did not log at all. Introduce dedicated enum values
-- so audit queries can filter cleanly:
--
--   RESOLVE_OPINION  — admin manually graded an ExpertOpinion as HIT/MISS/NOT_GRADED.
--   SUPPRESS_OPINION — admin hid an ExpertOpinion from the feed (suppressedAt set).
--
-- ALTER TYPE ... ADD VALUE is non-transactional in older Postgres, but Postgres 12+
-- supports it inside transactions. Using IF NOT EXISTS to keep the migration
-- idempotent in case it has been partially applied.

ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'RESOLVE_OPINION';
ALTER TYPE "AdminActionType" ADD VALUE IF NOT EXISTS 'SUPPRESS_OPINION';
