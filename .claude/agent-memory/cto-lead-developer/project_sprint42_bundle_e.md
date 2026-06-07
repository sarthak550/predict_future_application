---
name: project_sprint42_bundle_e
description: S42 Bundle E — T9+T12+T14 security/correctness fixes, all implemented and marked qa-review
metadata:
  type: project
---

S42 Bundle E is fully implemented. All three tickets are in `qa-review` in sprint-board.json.

**Why:** Security and correctness fixes — race conditions, JWT TTL, 429 handling, CSRF risk, schema integrity.

**T9 — Reasoning upvote atomic fix**
- File: `apps/api/app/api/positions/[positionId]/upvote-reasoning/route.ts`
- Fix: replaced read-count-then-write with `data: { reasoningUpvotes: { increment: 1 } }` / `{ decrement: 1 }` inside transaction

**T12 — Web auth + verify-phone + bond fixes (4 sub-items)**
- `apps/web/lib/auth.ts`: 5-min JWT TTL cache (`refreshedAt` timestamp, `CACHE_TTL_MS = 5 * 60 * 1000`)
- `apps/api/app/api/users/me/verify-phone/confirm/route.ts`: updateMany guard with `phoneVerified: false` predicate; `bonusCredited` flag
- `apps/api/app/api/users/me/verify-phone/route.ts`: rate-limit before DB lookups
- `apps/api/lib/markets/bond.ts`: `lockBondCapPoints` uses guarded updateMany; old TOCTOU check removed

**T14 — Misc fixes (5 sub-items)**
- `apps/api/lib/ai/evaluateOpinionResolution.ts`: `_lastCallRateLimited` module sentinel + `wasLastCallRateLimited()` export; Groq/Gemini set flag on 429
- `apps/api/app/api/cron/auto-resolve-opinions/route.ts`: skip attempt increment on 429; removed GET alias (CSRF risk)
- `apps/api/prisma/schema.prisma`: `BigCallTap` model added with FK relations + back-references on User/Market
- `apps/api/prisma/migrations/20260524000008_s42_bigcalltap_fks/migration.sql`: manual migration (shadow DB incompatible)
- `apps/api/lib/ai/extractExpertOpinions.ts`: always `verified: false` in expert upsert (never trust AI output)
- `apps/api/app/api/finance/experts/[id]/route.ts`: pagination with skip/take/hasMore

**Known pre-existing TS errors in auto-resolve-opinions/route.ts**: schema drift from prior sprints (`notifiedAt`, `analystCallAt`, `preprocessAttempts`, etc. not in current schema). Out of scope for this bundle.

**How to apply:** QA should verify these files match the spec above. Sprint board entries were added after the original session context was lost.
