---
name: Sprint 35 Finance UX
description: S35 T1-T3: LivePulseTape, Big Call Hero, Time-Aware Header — all qa-review
type: project
---

Sprint 35 — all 3 tickets in qa-review.

**S35-T1: LivePulseTape**
Replaced PulseRibbon with LivePulseTape in finance-mode.tsx.
- NSE fetch: `https://www.nseindia.com/api/allIndices` — 15-min React state cache
- USD/INR: `https://open.er-api.com/v6/latest/USD` — 24h AsyncStorage cache (key: `finance:usdInrCache`)
- 5 chips: NIFTY 50, BANK NIFTY, USD/INR, macro countdown, expert call
- Ticker chip tap: toggles `activeInstrumentFilter` state — feeds into opinion filter (instrument/instrumentTicker match)
- Macro countdown tap: opens events PulseSheet (events sheet kept, sentiment + calendar sheets retired)
- Expert chip tap: scrolls to Big Call hero, triggers 300ms Animated highlight ring via `bigCallHighlight` ref
- Kebab (3 dots): opens `CalendarModal` inline — lists eventClusters from finance data
- Shimmer: 3 Animated.View pulsing (0.4↔1 opacity loop) before first fetch resolves
- `PulseKind` now only has `"events"` type (sentiment removed)
- New `USD_INR_CACHE_KEY` constant: `"finance:usdInrCache"`

**S35-T2: Big Call Hero**
New `GET /api/finance/big-call` public endpoint.
- Expert model has NO analystTier/accuracyScore — verified=true maps to CHIEF_ANALYST proxy, false → ANALYST
- Scoring: tierWeight × freshness × clusterHeat × pollAVolumeNorm
- Post-resolution: HIT + resolvedAt within 24h + pollAVotes≥20 → score = tierWeight×1.5 + "CALLED IT" badge
- 60-min Cache-Control header: `public, s-maxage=3600, stale-while-revalidate=300`
- `headline` field added to ExpertOpinion schema (nullable String)
- Migration: `apps/api/prisma/migrations/20260521000001_add_opinion_headline/migration.sql`
- `generateHeadline.ts` in `apps/api/lib/ai/` — Gemini call → 4-6 word headline → rule-based fallback
- Backfill script: `apps/api/scripts/backfill-opinion-headlines.ts` — idempotent, skips existing headlines
- BigCallHeroCard in finance-mode.tsx: 48px avatar, name/org/tier, verdict badge (purple if isPostResolution), 18px headline, VOTE NOW → /finance/poll/[id], SHARE via native Share.share()
- `apiClient.getFinanceBigCall()` added
- `ApiFinanceBigCallOpinion` type in packages/types
- Highlight ring: Animated borderColor on `Animated.View` wrapper wrapping `BigCallHeroCard`
- **Note:** Animated.View with interpolated borderColor/borderWidth — uses `as unknown as number` cast for borderWidth interpolation (RN limitation)

**S35-T3: Time-Aware Header + Personal Accuracy Chip**
- `getMarketWindow()` in finance-mode.tsx: 6 states (pre-market, live, closing-wrap, after-hours, weekend, holiday)
- `isNSEHoliday()` and `NSE_HOLIDAYS_2026` constant array in `apps/mobile/src/constants/nse-holidays-2026.ts`
- IST conversion: `UTC + 5.5 * 60 * 60 * 1000` offset
- Closing-wrap sort: during 15:30–20:00 IST, resolved opinions bubble to top in filteredGroups sort
- `PersonalAccuracyChip` component: 6 states, flame turns gold at 30-day streak (#F59E0B)
- `financeStreak` computed server-side: consecutive IST calendar days with Poll A votes
- `financeAccuracy` computed server-side: correct predictions (agreed+HIT or disagreed+MISS) / resolved votes
- `loadFinanceProfile()` in FinanceMode — calls `getMyProfile()` and reads `financeStreak/Accuracy/TotalVotes/ResolvedVotes`
- `/api/profile/[username]` now returns `financeStreak`, `financeAccuracy`, `financeTotalVotes`, `financeResolvedVotes`
- `ApiUserProfile` type updated with these 4 optional fields
- `marketWindow` stored as `useState` with initializer (not re-computed on render, captures mount-time window)

**Key decisions:**
- Sentiment sheet retired completely — state variable kept (fetched but unused) to avoid breaking load() destructuring
- Calendar sheet content moved to CalendarModal inside LivePulseTape (kebab opens it)
- `analystSentiment` state/fetch kept but not rendered anywhere (low cost, may be reused)
- `handleSentimentCardPress` removed entirely (was unused after retirement)
- AnalystTierBadge has no `size` prop — used `surface="public"` instead

**Why:** Business requested Robinhood/LinkedIn polish on Finance tab. The tape replaces cluttered 3-pill ribbon with live market data. Big Call hero creates a daily appointment mechanic. Time-aware header creates context-specific engagement copy.

**How to apply:** finance-mode.tsx is now ~2500+ LOC — keep all new components above the FinanceMode export, keep styles co-located with their components.
