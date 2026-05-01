---
name: Product State After Sprint 8
description: Verified current state of Predict Future after sprints 7 and 8 completed — architecture facts, auth reality, UX gaps, and process failures discovered during CEO review 2026-05-02
type: project
---

Post-Sprint 8 product state (verified 2026-05-02 by reading source):

## Architecture (confirmed)

Two separate Next.js apps:
- `apps/api` (port 3001) — the backend the mobile app talks to. Has 63 API routes. Uses `getUserIdFromRequest()` in auth.ts which handles both Bearer JWT (mobile) and NextAuth session cookie (web). Mobile auth is at `/api/auth/mobile/login` and `/api/auth/mobile/register`, issues custom JWTs.
- `apps/web` — the web frontend. Has its own duplicate set of API routes using `getSession()` (NextAuth only). Web users authenticate via cookie session.

The mobile app reads `EXPO_PUBLIC_API_BASE_URL` (defaults to localhost:3001) and sends Bearer JWT to `apps/api`.

Admin routes in `apps/api` still use `getSession()` — intentional since admins use the web admin panel, not the mobile app.

## What's actually in the nav (confirmed)

5-tab nav: Feed | Sports | Create | Markets | Profile  
Leaderboard and Groups tabs exist as screens but `href: null` hides them from the tab bar. Both are reachable via links in the Profile scroll.

## Auth state (confirmed)

The S8 summary saying "we patched many routes" referred to patching `apps/api` routes to use `getUserIdFromRequest` instead of `getSession`. The `apps/web` routes still use `getSession` only — this is architecturally correct since web users use cookie auth.

41 out of 63 `apps/api` routes use `getUserIdFromRequest`. Remaining 22 that use `getSession` directly are all admin routes — acceptable.

## Profile screen (confirmed)

Profile is a single ScrollView with: header card → P&L card → Badges shelf → Recent Positions → Category Breakdown → My Markets → My Predictions (Bets/Polls tabs) → Watchlist → Leaderboard link → Host Stats → Groups accordion → Groups link → Notifications action row → Replay Tutorial → Log Out. Very dense. Scroll depth to reach Leaderboard/Groups links is substantial.

## Markets screen (confirmed)

Three top-level mode tabs: Explore | My Groups | Polls. Explore has: search bar → sort chips → trending shelf → category pills → status tabs (Live/Cancelled/Settled) → market list. Rich but complex nav hierarchy.

## QA process failure (confirmed — deps issue)

12 packages (`expo-notifications`, `@react-native-async-storage/async-storage`, `@react-navigation/native`, `react-native-gesture-handler`, etc.) were used in code but not declared in `apps/mobile/package.json`. QA passed tickets without doing real builds. Fixed: all deps declared, QA agent Check F now validates imports against package.json.

## Key UX gaps identified in CEO review

1. Profile scroll depth — Leaderboard and Groups links are buried. New users have no reason to scroll that far.
2. Groups are invite-code only with no discovery — the entry point ("Join a Group with Code") is at the bottom of a long profile scroll. Zero virality path.
3. The Markets screen has three levels of filtering UI stacked (mode toggle → sort chips → status tabs → category pills). Total of 4 filter layers before you see a market. Cognitive load is high.
4. PredictionsSection in Profile renders a Bets tab that is permanently empty for most users (positions are shown in RecentPositions above; the Bets/Polls section gets `positions: []` passed — line 255 passes empty array). Dead tab.
5. `castVote` route `/api/markets/[marketId]/vote` is called with `auth: true` — need to verify this route exists in `apps/api`. It was not found in the directory listing above. If missing, poll voting is silently broken on mobile.

**Why:** These gaps weren't caught because QA was not doing real device builds or user-journey walkthroughs.
**How to apply:** Next sprint should prioritize: (a) verifying vote route exists, (b) flattening Markets filter hierarchy, (c) making Groups discoverable without burying the entry point.
