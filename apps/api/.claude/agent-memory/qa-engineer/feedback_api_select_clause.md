---
name: Security — leaderboard route leaks full user rows due to missing select clause
description: prisma.user.findMany without select returns passwordHash, email, expoPushToken to all callers
type: feedback
---

**Rule:** Any Prisma `findMany` or `findUnique` on the `User` model in a public API route MUST include a `select` clause that explicitly whitelists only the fields needed. Omitting `select` returns the full row including `passwordHash`, `email`, `emailVerified`, `expoPushToken`, `isSuspended`, `suspendedReason`.

**Why:** Found in S12 QA 2026-05-02. The all-categories leaderboard path (`apps/api/app/api/leaderboard/route.ts` line 138) uses `prisma.user.findMany({ include: { stats: true } })` with no `select`. Live curl confirmed: response to unauthenticated callers contains `passwordHash` and `expoPushToken` for every ranked user.

**How to apply:** When reviewing any API route that queries the User model, run the route under runtime check and inspect the raw JSON response keys. If `passwordHash` or `email` appear, it is an immediate FAIL regardless of TypeScript passing. The category path on the same route (using `userCategoryStat.findMany` with `include: { user: { select: { username, reputationScore } } }`) is correct and shows the safe pattern.
