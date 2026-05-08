---
name: Sprint 17 — Critical Fixes + Finance Polish
description: What was built in Sprint 17, key technical decisions, and non-obvious implementation details
type: project
---

Sprint 17 is complete (all 6 tickets in qa-review as of 2026-05-01).

**Theme:** Critical fixes + Finance section polish — dead routes, human-in-the-loop oversight, UI credibility.

## Key decisions and non-obvious details

**S17-T1: Story screen + deep-link normalization**
- Created `apps/mobile/src/app/story/[id].tsx` — the route was completely missing before.
- Fixed notification `href` in `apps/api/app/api/admin/expert-opinions/[id]/resolve/route.ts` from `/stories/` to `/story/` (singular). This was the source of all broken notification taps.

**S17-T2: Admin expert-opinion review queue**
- Web app needed its OWN API routes (`apps/web/app/api/admin/...`) because the client.tsx component calls relative URLs — it can't hit `apps/api` directly.
- Added `suppressedAt DateTime?` to `ExpertOpinion` in Prisma schema. Used `db push` (not `migrate dev`) due to shadow DB P3006 error — manually created migration SQL at `apps/api/prisma/migrations/20260503120000_add_expert_opinion_suppressed_at/migration.sql`.
- All public opinion queries now filter `where: { suppressedAt: null }`.

**S17-T3: Expert avatar colorful initials**
- Created `apps/mobile/src/utils/expertAvatar.ts` with `getExpertInitialsColor(name)` and `getExpertInitials(name, org)`.
- Color is deterministically hashed from the expert name — consistent across renders with no state.
- Updated: `expert-leaderboard.tsx`, `expert/[id].tsx`, `news-feed-card.tsx`.

**S17-T4: Finance discovery chip on Feed cards**
- Condition: `item.category === 'FINANCE' && item.expertOpinions?.length > 0`.
- Navigation: `router.push('/(tabs)/finance')` — Finance is a dedicated tab, NOT a mode param of Markets.
- Chip added in `news-feed-card.tsx` between summary and meta row.

**S17-T5: ExpertOpinionCard visual polish + Finance empty states**
- `DIRECTION_CONFIG` in `news-feed-card.tsx` now includes `prefix` ('↑'/'↓'/'—') and updated colors (`#06D6A0`, `#E84855`, `#6B7280`).
- `ExpertOpinionRow` restructured: `bylineRow` (name+org left, direction badge right), `quoteBlock` with 3px left-accent bar.
- `SentimentCard` in `finance-mode.tsx` shows `▲/▼ Npts vs yesterday` or `(new)` badge.
- `previousDayScore` computed inline in `/api/finance/markets/route.ts` by counting yesterday's votes — no new schema table needed.
- `ApiFinanceSentiment` type extended with `previousDayScore: number | null`.
- Expert Opinions empty state replaced with rich card: 📊 icon, "No expert takes yet", subtitle, "View all finance markets ↓" link.

**S17-T6: AI extraction daily cost guardrail**
- Module-level in-memory counter in `extractExpertOpinions.ts`: `_dailyCallCount` + `_dailyCallDate`.
- Counter resets automatically when UTC date rolls over — checked at the top of each call.
- Cap reads from `FINANCE_AI_DAILY_CAP` env var (default 50). Created `apps/api/.env.example`.
- Counter increment happens BEFORE the AI call (conservative: counts intent, not just success).

**Why:** line for each:
- T1-T2: `ExpertOpinionCard.onPress` and notification taps both routed to dead URLs — blocked the entire expert opinion UX.
- T3: Flat grey initials looked untrustworthy on a credibility-focused feature.
- T4: The discovery path from Feed to Finance was broken when the full Expert Take section was removed from Feed cards.
- T5: Finance tab looked raw and data-dense without visual hierarchy.
- T6: If Groq degrades, every ingested story would call Gemini — $$ risk on high-traffic days.
