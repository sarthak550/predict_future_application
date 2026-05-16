---
name: Sprint 30 partial QA — S30-T1 still blocked, T2-T6 done
description: S30-T2/T3/T4/T5/T6 all passed; S30-T1 failed twice — first for missing aggregate, now for Prisma client not regenerated after schema change
type: project
---

Sprint 30 QA results (2026-05-16, second round):

**S30-T1 — FAIL (second attempt)**: The aggregate query `prisma.marketPosition.aggregate({ _sum: { reasoningUpvotes: true } })` is now present in apps/api/app/api/profile/me/route.ts (line 199-203). The field is in the schema. However, `npx prisma generate` was NOT run after the schema change. The generated client at node_modules/@prisma/client/index.d.ts contains 0 references to `reasoningUpvotes` or `ReasoningUpvote`. GET /api/profile/me returns HTTP 500 with empty body. CTO must run `cd apps/api && npx prisma generate` and restart the dev server.

This is the second time this sprint the Prisma-generate-missing failure has appeared (S28-T1 was the first instance overall).

**S30-T2 — PASS**: tierProgress computed and returned in /api/profile/me, TierProgressSection renders progress bars with isEligible chip.

**S30-T3 — PASS**: recentCalls returned from /api/profile/[username], web SEO page renders reasoning, mobile user/[username].tsx has RecentCallsSection.

**S30-T4 — PASS** (from prior round).

**S30-T5 — PASS** (from prior round).

**S30-T6 — PASS**: apps/api/app/admin/ directory deleted. apps/web/app/(admin)/admin/big-call/page.tsx created with correct columns (Date, Market link, Opens, Participants, Outcome), 3-card stats banner (7-day avg opens, highest ever, total Big Call days), back-link to /admin (not /api/admin), and nav card in apps/web/app/(admin)/admin/page.tsx pointing to /admin/big-call. TypeScript clean.

TypeScript: both apps/api and apps/mobile compile clean (0 errors).

**Why S30-T1 keeps failing:** First miss was a missing aggregate in /api/profile/me. Second miss is that the schema was updated but generate was not re-run before the fix was submitted. CTO needs to add `prisma generate` to their local dev workflow whenever schema.prisma changes.
