---
name: Sprint 29 status — T1/T2/T3 complete, T4/T5/T6 pending
description: S29-T1, T2, T3 all passed QA on re-verification after CTO applied Prisma migrations and reseeded. T4, T5, T6 still pending qa-review.
type: project
---

S29-T1: Leaderboard tab REVERTED per user request. Tab order is Feed/Finance/Create/Markets/Profile. Leaderboard has href:null. Sports/notifications/groups/leaderboard all hidden. PASS.

S29-T2: LeaderboardSnapshot model confirmed in schema with @@index([userId, timeWindow, category, snapshotAt]). User model has leaderboardSnapshots relation. Cron route at /api/cron/leaderboard-snapshot guards with CRON_SECRET, handles all timeWindow x category combos. Leaderboard route computes rankDelta from getPreviousRankMap helper. Seed.ts inserts snapshots 8 days ago for top 10 users. vercel.json has cron entry "59 18 * * 0". ApiLeaderboardEntry has rankDelta?: number | null. Runtime (port 3001): leaderboard returns 7 entries with non-null rankDelta values (e.g. maya delta=2, kira delta=-1). PASS.

S29-T3: reasoning String? on MarketPosition confirmed. ApiMarketPosition and ApiPositionSummary both have reasoning?: string | null in packages/types. marketPositionSchema validates: trim, empty to null, max 500 chars. positions/route.ts stores reasoning: payload.reasoning ?? null. Market detail GET (line 125) includes reasoning: true in position SELECT. profile/me route (line 49) includes reasoning: true in positions SELECT (this was the previously failing fix — now confirmed present). Mobile market/[id].tsx has collapsible "Add your reasoning" row, TextInput maxLength=500, char counter. Web profile/[username]/page.tsx displays reasoning where present. Runtime: profile/me returns 6 positions all with reasoning key present (null for seeded data). PASS.

S29-T4, S29-T5, S29-T6: still in qa-review status as of 2026-05-16.

**Why:** CTO applied Prisma migrations (db push), regenerated client, reseeded LeaderboardSnapshot fixtures, restarted dev server between first QA failure and this re-verification.

**Note:** Server runs on port 3001, not port 3000. The ticket said port 3000 but the server is at 3001.
