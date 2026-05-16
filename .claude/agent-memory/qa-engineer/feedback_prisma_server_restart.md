---
name: prisma generate requires server restart
description: After prisma generate, the Next.js dev server must be restarted — otherwise global.prisma holds a stale client that 500s on new schema fields
type: feedback
---

After running `prisma generate`, the Next.js dev server (`next dev`) must be restarted. The `lib/prisma.ts` module uses a `global.prisma` singleton that is created once when the server process starts. If `prisma generate` runs after the server started, `global.prisma` holds an old PrismaClient that doesn't know about new schema fields. Any route that selects or filters on new fields will throw a Prisma validation error at runtime ("Unknown field X for select statement on model Y").

**Why:** Caught on S24-T6. The schema added `referredById`, `referralCode`, and `referrals` relation. `prisma generate` ran at 10:53, but the dev server started at 9:52 with the old client. Runtime result: POST /api/markets/[marketId]/positions returned 400 with "Unknown field referredById" and GET /api/users/me/referral-code returned 500. Code was correct; environment was broken.

**How to apply:** On any ticket that adds Prisma schema fields, include "restart the dev API server after prisma generate" as part of the CTO's deployment checklist. During runtime verification, if new schema fields cause 500s but the standalone Prisma query works, suspect a stale global.prisma singleton before diagnosing the code.

**Confirmed again on S24-T11 (2026-05-06):** `originPlatform` and `externalId` absent from live /api/markets response even though both were present in Prisma client type definitions and confirmed via `prisma db pull`. Also `winningOptionId` and `sumToHundred` (from earlier sprints) also missing — confirming this is a persistent stale-server environment issue, not a code regression. Dev server has not been restarted since the last schema migration cycle. QA assessment: code is correct; server restart required for runtime to reflect schema.
