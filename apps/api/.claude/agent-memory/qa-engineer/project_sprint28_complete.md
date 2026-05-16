---
name: Sprint 28 complete — Finance UX personalization
description: All 4 S28 tickets passed QA on 2026-05-16; S28-T1 re-verified after Prisma generate was run
type: project
---

Sprint 28 COMPLETE. All 4 tickets passed QA on 2026-05-16.

**Tickets:**
- S28-T1: Finance Analyst Follow System — PASS (re-verified after `npx prisma generate`)
- S28-T2: Infinite scroll pagination — PASS
- S28-T3: Direction filter chips + tappable Sentiment Card — PASS
- S28-T4: Crowd-vs-Expert comparison card — PASS

**Why S28-T1 initially failed:** Dev server was started before `npx prisma generate` was run after adding the ExpertFollow model. The in-memory Prisma client did not have the model, causing 500s on all expertFollow DB calls.

**Re-verification evidence:**
- node_modules/.prisma/client/index.d.ts: 686 references to expertFollow/ExpertFollow — client was regenerated
- POST /api/finance/experts/:id/follow returns 404 (expert not found) for nonexistent ID, confirming auth resolves and DB call reaches expert lookup correctly
- GET /api/finance/experts/followed returns { expertIds: [] } correctly for authenticated user
- TypeScript: both API and mobile compile cleanly
- My Analysts chip row and selectedAnalystFilter logic fully implemented in finance-mode.tsx
- Follow/Following pill button in ExpertOpinionRow (news-feed-card.tsx line 628)
- api-client followExpert/unfollowExpert/getFollowedExperts all have auth: true

**How to apply:** Sprint 28 is fully closed. Next sprint can begin.
