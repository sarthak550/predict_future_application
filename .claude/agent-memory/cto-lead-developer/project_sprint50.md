---
name: project_sprint50
description: S50: Move Top Analysts surface from Feed BigCallCard to Finance tab inline card — BigCallCard removed, TopAnalystsSheet deleted, TopAnalystsCard created.
metadata:
  type: project
---

Sprint 50 — semantic correction of S49 placement error.

**Root cause of S49 miss:** BigCallCard surfaces ANY category market (sports, tech, finance). Top 3 analysts are India sell-side finance analysts. Attaching them to a generic market surface creates cognitive dissonance. Fix: Finance tab's BigCallHeroCard is finance-only — correct semantic home.

**Files changed:**
- `apps/mobile/src/app/(tabs)/feed.tsx` — removed BigCallCard component, bigCallMarket/topExpert/topAnalystsSheetVisible state, both fetch useEffects, TopAnalystsSheet mount, AnalystCredibilityBadge + TopAnalystsSheet imports
- `apps/mobile/src/components/top-analysts-card.tsx` — NEW; always-visible inline 3-row card with loading/empty states; props: entries, loading, onLeaderboardPress, onAnalystPress; analytics: `analysts_leaderboard_card_tapped`
- `apps/mobile/src/components/finance-mode.tsx` — added TopAnalystsCard import + ApiTopExpertEntry type import; added topWeeklyExperts/topWeeklyLoading/topWeeklyRefetchEpoch state; added independent useEffect for /api/experts/top-weekly; topWeeklyRefetchEpoch increments on pull-to-refresh; card renders unconditionally below BigCallHeroCard (not gated on bigCallOpinion)
- `apps/mobile/src/components/top-analysts-sheet.tsx` — DELETED
- `apps/mobile/src/components/analyst-credibility-badge.tsx` — removed `"bigcall_footer"` from AnalystBadgeSurface union
- `apps/api/app/api/markets/today-big-call/route.ts` — comment-only: "Feed tab no longer calls this endpoint. Retained for future editorial surfaces and push cron."

**T3 scroll-ref finding:** bigCallY ref is on the wrapper View containing BigCallHeroCard. TopAnalystsCard is inserted AFTER that View's closing tag, so the onLayout measurement is unaffected. No adjustment needed.

**T5 findings:** Exactly 1 occurrence of `"bigcall_footer"` in the codebase — the AnalystBadgeSurface union type in analyst-credibility-badge.tsx. All callsites were eliminated by T1 (BigCallCard component deleted). T5 removed the union member itself.

**Pre-existing API TS error:** seed_s49_demo.ts has a type error on prisma createMany return — unrelated to S50, pre-existing untracked file, not blocking.

**Why:** [[project_sprint49]] — S49 placed analysts on Feed's BigCallCard which could surface non-finance markets. S50 moves them to Finance tab where all editorial content is finance-specific.
