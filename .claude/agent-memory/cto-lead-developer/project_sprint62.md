---
name: project_sprint62
description: S62 T1 schema foundation for the new lightweight Poll system — PollStatus enum, Poll, PollOption, PollVote models, additive UserStat fields
metadata:
  type: project
---

S62 T1: Added the new lightweight Poll system schema to `apps/api/prisma/schema.prisma`. Applied via `db push` (not `migrate dev`) because the shadow DB cannot replay old migrations that reference `MarketCategory` enum which only exists in the live DB.

Migration file created manually at `prisma/migrations/20260628000001_s62_poll_models/migration.sql`.

**Models added:**
- `enum PollStatus { OPEN, CLOSED, RESOLVED }` — mirrors MarketStatus spirit, kept minimal
- `Poll` — question, description, category (reuses MarketCategory), status, closeAt, resolvedAt, winningOptionId, structuredData (Json?), packId (String? for grouping RBI twin-question packs), eventAt (DateTime?), storyId (String? @unique for future news polls), createdById, timestamps; indexes on (status,closeAt), packId, (createdById,createdAt), (category,status)
- `PollOption` — pollId (Cascade), label, sortOrder; index on pollId
- `PollVote` — pollId (Cascade), optionId (Cascade to PollOption), userId (Cascade), isCorrect (Boolean?), lockedAt (DateTime?), createdAt; @@unique([pollId,userId]); indexes on pollId, userId, optionId
- `UserStat` additive fields: `totalPollPredictions Int @default(0)`, `pollAccuracyScore Float @default(0)`
- Reverse relations on `User`: `createdPolls Poll[] @relation("CreatedPolls")`, `pollVotes PollVote[] @relation("PollVotes")`

**What was NOT changed:** Market model, any other existing model.

**Why db push:** `migrate dev` fails with `P3006` on all shadow-DB replays — old migrations reference `MarketCategory` enum which the shadow DB doesn't have. This is a known pattern in this repo (same as S35, S38, etc.).

**How to apply:** Continue using `db push` + manually-written migration SQL for all future schema-only sprints until the shadow DB issue is resolved.

[[project_sprint61]]
