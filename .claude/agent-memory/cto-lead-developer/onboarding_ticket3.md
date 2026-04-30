---
name: Sprint 1 Ticket 3 — Mobile Onboarding Flow
description: Onboarding implementation decisions, file locations, and what remains for Sprint 2
type: project
---

## Status: COMPLETE

## What was built

Three-screen horizontal-swipe onboarding gate for new registrations.

### Files changed
- `apps/mobile/src/app/(auth)/sign-up.tsx` — added `isNew: true` to `signIn()` call; removed the `router.replace("/(tabs)/feed")` that was there before (onboarding redirect now happens from `index.tsx`)
- `apps/mobile/src/app/index.tsx` — added `isNewUser` destructure from `useSession()`; added `if (isNewUser) return <Redirect href="/onboarding" />` guard
- `apps/mobile/src/app/onboarding.tsx` — new file, 3-screen FlatList onboarding

### Key design decisions
1. **`isNewUser` is not persisted.** It is React state set only by `signIn({ isNew: true })`. Cold-launch session restore (`resolveInitialSession`) never sets `isNew`, so returning users always skip onboarding automatically — no SecureStore key needed.
2. **Static progress bars on screen 3.** New users have 0/14 days, 0/2 markets, 0/55 trust score on day 1. No API call made during onboarding — the ticket spec explicitly required this. Progress surfacing is deferred to Sprint 2.
3. **`handleComplete` uses `router.replace("/(tabs)/feed")` only.** `signOut()` was considered but rejected — it would log the user out. `isNewUser` resets to `false` on next cold launch naturally.
4. **`Stack.Screen options={{ headerShown: false }}`** placed inside the component so expo-router picks it up correctly.

### Progress bar implementation
- Track: `#E5E7EB`, fill: `colors.accent`
- Uses `flexDirection: "row"` with two `flex` children: `flex: fill` (filled portion) and `flex: 1 - fill` (empty portion). At 0% the fill view has `flex: 0` so it is invisible but the component still renders.
- At 0/target, `fill = 0` so bar shows entirely as the track color — correct per spec.

### Navigation flow
- New registration: sign-up → `signIn({ isNew: true })` → `index.tsx` → `/onboarding` → screen 3 "Get Started" or any "Skip" → `/(tabs)/feed`
- Returning user cold launch: `index.tsx` → `/(tabs)/feed` (isNewUser is false, not persisted)

## Pre-existing TS errors (NOT introduced by Ticket 3)
The following had errors before this ticket and remain untouched:
- `apps/mobile/src/app/(tabs)/sports.tsx` — type narrowing on lineup data
- `apps/mobile/src/app/notifications.tsx` — `ApiNotification` and `getNotifications`/`markNotificationsRead` missing from types/api-client
- `apps/mobile/src/components/prediction-card.tsx` — `yesCount`/`noCount`/`totalVotes` missing from `ApiMarketSummary`
- `apps/mobile/src/lib/create-prefill.ts` — `ApiPredictionSuggestion` missing from types

**Why:** These are stubs or type gaps from earlier tickets that need separate fixes.

## Sprint 2 backlog (what remains)
1. **Push notifications** — `ApiNotification` type and `getNotifications`/`markNotificationsRead` on the API client need to be wired up first (see pre-existing errors above)
2. **Share card** — social sharing for market predictions
3. **Host progress surfacing** — surface live `ApiHostEligibility` progress data in the host screen (screen 3 of onboarding shows static 0s; a dedicated "Host" tab or profile section should call the eligibility endpoint and show real progress bars)
4. **Fix prediction-card vote counts** — `yesCount`/`noCount`/`totalVotes` missing from `ApiMarketSummary` — needs types package update and API route change
