---
name: Sprint 32 - Flagship Event Polls
description: S32 T1-T6: flagship events schema (pre-done), Finance carousel, Create wizard toggle, expert consensus, push notifications, admin surface — all qa-review
type: project
---

Sprint 32 implements Policy & Big Events — admin-moderated polls on high-impact upcoming finance events shown in a new carousel on the Finance tab.

**Why:** CEO requested high-engagement flagship events (RBI MPC, Budget, GST, Fed) to drive Finance tab retention and prediction volume.

**Key decisions:**
- Schema (flagshipEventAt, flagshipEventType on Market) was already pushed in a prior commit — Prisma client already had the fields.
- T1 (schema+API) was entirely pre-implemented: flagship-events route, mark-flagship admin route, types, api-client were all done.
- T4 (expert consensus) was also pre-implemented in flagship-events route with full BINARY and MULTIPLE_CHOICE support, < 3 expert null guard.
- T2: FlagshipEventsCarousel inserted ABOVE AnalystSentimentCard in finance-mode.tsx; hidden when events.length === 0.
- T3: Flagship toggle in Create wizard (Finance category only); closeAt auto-synced to flagshipEventAt; fields passed outside createMarketSchema validation directly to createPredictionMarket.
- T5: sendBroadcastPush() added to approve route (fire-and-forget after approval); daily cron /api/cron/flagship-reminder at 15 9 * * * UTC finds markets with flagshipEventAt in next 23-25h window.
- T6: Moderation page sorts [flagshipEventAt asc, createdAt asc] and shows amber badge; /admin/flagship-events page with MarkFlagshipForm client component; link from admin home.

**Pre-existing web TypeScript errors (not introduced by S32):**
- apps/web/lib/stats.ts: MULTIPLE_CHOICE marketType mismatch (pre-existing since S24-T10)
- apps/web/lib/markets/create.ts:218: string | undefined mismatch (pre-existing)
Both apps/api and apps/mobile tsc --noEmit are clean.

**How to apply:** When touching flagship code, note that crowdProbability uses yesPool/noPool for BINARY and options[].totalStaked for MULTIPLE_CHOICE. expertProbability uses positions[] for BINARY and multiChoicePositions[] for MULTIPLE_CHOICE, filtered by isVerifiedAnalyst OR analystTier IN (ANALYST, SENIOR_ANALYST, CHIEF_ANALYST).
