---
name: project_sprint68
description: S68 Profile/Markets bundle — T1 balance pill, T2 bet panel balance, T3 positions endpoint + mybets chip, T4 see-all-my-bets link, T5 watchlist routing
metadata:
  type: project
---

S68 Profile/Markets bundle — all 5 tickets COMPLETE, both tsc 0.

## T1 — Balance pill in profile header
- File: `apps/mobile/src/app/(tabs)/profile.tsx`
- Added `balancePill` + `balancePillText` styles to `makeStyles`
- Rendered inline below `analystHeadline` in the `headerRight` block
- Conditioned on `user.wallet?.balance != null`; format: `{n.toLocaleString()} pts`
- accentSoft bg, accent text, 12/700, pill border-radius

## T2 — Bet panel: Available balance + low-balance hint
- File: `apps/mobile/src/app/market/[id].tsx`
- Added `ApiMyProfile` import; fetched `mobileApi.getMyProfile()` via `useApiQuery` at screen level; extracted `walletBalance: number | null`
- Added `walletBalance` prop to `StickyBettingBarProps`, `BettingSheetProps`, `MultiChoiceBettingSheetProps`
- In each sheet: `sheetTitleWrap` View wraps title + `sheetBalanceHint` ("Available: X pts", textMuted, 13)
- Low-balance warning: orange (#D97706) row with warning-outline icon, shown when `walletBalance != null && betAmount >= 50 && betAmount > walletBalance`; informational only, does NOT disable Submit
- Added styles: `sheetTitleWrap`, `sheetBalanceHint`, `lowBalanceWarning`, `lowBalanceWarningText`

## T3 — My Bets: positions endpoint + mybets chip + deep-link
- **Backend**: `apps/api/app/api/profile/me/positions/route.ts` — new GET endpoint; no cap; application-level sort (OPEN first, then non-terminal, then RESOLVED/CANCELLED); returns `{ positions, total }`
- **Types**: `packages/types/src/index.ts` — `ApiMyPositionsResponse = { positions: ApiPositionSummary[]; total: number }`
- **API client**: `packages/api-client/src/index.ts` — `getMyPositions()` method added after `getMyMarkets()`
- **Mobile**: `apps/mobile/src/app/(tabs)/markets.tsx`:
  - Added `Ionicons` import, `useLocalSearchParams` import
  - `StatusTab` union: added `"mybets"`
  - `VIEW_CHIPS`: appended `{ label: "My Bets", statusTab: "mybets", sort: "new" }`
  - Deep-link: `useLocalSearchParams<{ tab?: string }>()` + `deepLinkApplied` ref; on mount once, pre-selects `saved` or `mybets`
  - My bets state: `myBetsPositions`, `myBetsLoading`, `myBetsError`, `loadMyBets`; dedupes by `market.id`
  - `filteredMarkets`: returns `[]` for `mybets` (separate FlatList used)
  - Loading/error derived state: handles `mybets` branch
  - `handleRefresh`: handles `mybets` branch
  - Loading guard: skips for `mybets` and `saved`
  - Render: conditional FlatList split — mybets renders `BetMarketRow` list, rest renders `MarketSummaryCard`
  - `BetMarketRow` component: market title, side badge (colored), stake "X pts", status pill, win/loss icon for resolved
  - Empty state: "You haven't placed any bets yet — explore markets to get started." with Browse Markets button
  - Added `makeBetRowStyles`

## T4 — "See all my bets" link in ActivitySection
- File: `apps/mobile/src/app/(tabs)/profile.tsx`
- In `ActivitySection`, after `displayItems.map`, rendered a `seeAllBetsRow` when `betItems.length > 0`
- Routes to `/(tabs)/markets?tab=mybets`
- Style: accent 13/600, chevron, borderTop divider — matches seeAllRow in MarketsSection
- Added `useTheme()` to `ActivitySection` (needed for chevron color)

## T5 — Watchlist "More" routing + labels
- File: `apps/mobile/src/app/(tabs)/profile.tsx`
- Watchlist overflow row: route `/(tabs)/markets?tab=saved`, label "See all saved"
- My Markets overflow row: label "See all my markets" (route unchanged — stays at `/(tabs)/markets`)

**Why:** Per-call resolution windows and positions cap (take:10) meant profile data was insufficient for a real My Bets tab. New endpoint returns all positions without cap.
