---
name: Sprint 29 Implementation Notes
description: Key architectural decisions and patterns used in Sprint 29 ticket implementations
type: project
---

Sprint 29 (2026-05-16) — 6 tickets implemented.

**Why:** Sprint 29 focus was identity/engagement layer: Leaderboard visibility, rank tracking, analyst identity, and personalization.

**Key decisions:**

1. S29-T2 LeaderboardSnapshot: Used `db push` instead of `migrate dev` because shadow DB was missing enum types from prior failed migrations. Manual migration SQL files created to preserve history.

2. S29-T3 Reasoning field: Added to Zod schema (packages/validation) with trim+null transform. The schema converts empty string to null so no empty strings reach the DB.

3. S29-T4 For You feed: Implemented as two parallel Prisma queries (boosted + regular) merged in JS — avoids complex raw SQL while keeping the implementation simple and correct.

4. S29-T5 Analyst Tier: `computeTierFromStats` is a pure function (no DB). `updateAnalystTier` wraps it with a DB write. Resolution path calls `updateAnalystTier` fire-and-forget after transaction commit to avoid extending the transaction window.

5. S29-T6 MSG91: Fixed endpoint from `api.msg91.com` → `control.msg91.com`. Removed `authkey` from body (belongs only in header per v5 spec). The try/catch wraps the full fetch call so network failures are also caught.

**How to apply:** When adding new cron routes, follow the `hasCronAccess` pattern (supports both Authorization Bearer and x-cron-secret headers). When adding schema fields with `db push`, always create manual migration SQL files in prisma/migrations/.
