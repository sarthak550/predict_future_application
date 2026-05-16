---
name: Sprint 7 Tickets T3-T8
description: Sprint 7 T3-T8 implementation details, file locations, and critical patterns
type: project
---

All 8 Sprint 7 tickets are complete and TS-verified. Key facts:

**T3 — Onboarding walkthrough** (DONE)
- Component: `apps/mobile/src/components/onboarding-walkthrough.tsx`
- Exports: `OnboardingWalkthrough` (modal overlay) + `resetOnboarding()` async function
- AsyncStorage key: `onboarding_complete`
- Mounted in: `apps/mobile/src/app/(tabs)/_layout.tsx` (before `<Tabs>`)

**T4 — Streak + daily engagement** (DONE)
- Components: `apps/mobile/src/components/streak-reminder.tsx`
- Exports: `StreakReminder` (modal), `StreakBadge` (fire emoji + count)
- AsyncStorage keys: `streak_reminder_shown_date`, `streak_last_known`
- `StreakReminder` mounted in `_layout.tsx` (before `<Tabs>`)
- `StreakBadge` rendered in `feed.tsx` category bar (streak >= 2)
- `lastPredictionAt` added to `ApiUserProfile` in `packages/types/src/index.ts`

**T5 — Sports tab linked markets + create prefill** (DONE)
- `apps/mobile/src/app/(tabs)/sports.tsx`: `LinkedMarketsPanel` component, `handleCreatePrediction`, linked markets fetch using `getPublicMarkets({ q, category: "SPORTS", limit: 5 })`
- `apps/mobile/src/app/(tabs)/create.tsx`: reads `initialTitle` + `initialCategory` from `useLocalSearchParams`
- Cricket/football types fully typed in `packages/types/src/index.ts` (replaced `Record<string, unknown>`)

**T6 — P&L Summary Card** (DONE)
- API: `apps/api/app/api/profile/me/route.ts` — added `resolvedPositions` query (3rd Promise.all item), computes `totalStaked`, `totalReturned`, `netPnl`, `resolvedMarketCount`, returns as `pnl` field
- Uses `MarketPosition.payoutAmount` field for totalReturned
- Type: `ApiPnlSummary` exported from `packages/types/src/index.ts`
- Mobile: `PnlSummaryCard` component in `profile.tsx`, shown after header card
- "Replay Tutorial" action row added to profile actions, calls `resetOnboarding()`

**T7 — Share markets with deep links** (DONE)
- URL pattern: `https://predictfuture.app/markets/${marketId}`
- `market/[id].tsx`: `shareOpenMarket()` + `shareMarketResult()` functions, Share button in topRow
- `market-summary-card.tsx`: `shareMarket()` standalone function + Share button in topRow

**T8 — Markets tab sort + trending shelf** (DONE)
- `apps/mobile/src/app/(tabs)/markets.tsx`: `MarketSort` type, `SORT_OPTIONS` array, sort state, `publicFetcher` includes sort dep, trending markets separate useEffect (mode=public), `TrendingCard` component, `ListHeader` useMemo with trending shelf + category pills
- API: `apps/api/app/api/markets/route.ts` — added `close_at` sort, `volume` sort, `limit` param handling
- `packages/api-client/src/index.ts`: `PublicMarketsQuery` now has `limit?: number` and sort options `close_at` + `volume`

**Why:** To clarify pre-existing vs sprint errors — 14 pre-existing mobile TS errors remain after sprint (sign-in/sign-up, notifications, group launchGroup, prediction-card, create-prefill). None introduced by our work.
