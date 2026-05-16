---
name: CTO Assignment Brief — Sprint 4-6 Tickets
description: 8 formal engineering tickets written by CEO for CTO, covering the next phase after Sprint 1-3 delivery. Issued 2026-05-01. Focuses on profile/identity, leaderboard, host resolve flow, comments, notification inbox, market creation improvements, web parity, and watchlist.
type: project
---

# CTO Assignment Brief — Predict Future, Sprint 4-6
**Issued:** 2026-05-01
**From:** CEO
**To:** CTO / Lead Developer
**Status of prior sprints:** All 8 Sprint 1-3 tickets confirmed delivered.

---

## Context

All 8 foundation tickets have shipped. The platform now has:
- Real JWT auth end-to-end (SecureStore persistence, cold-launch restore, isNewUser flag)
- Market detail with estimated return calculator, position display, animated probability bar, 15s polling, LIVE badge, share result + share open market
- 3-screen onboarding carousel for new users
- Push notifications (Expo push token registration, fire-and-forget on resolution)
- Host progress dashboard on Create tab (all 5 eligibility criteria with progress bars)
- Group prediction leagues (GroupDetailScreen, Start Matchday button, invite code copy, launch API)
- Real-time probability updates (useInterval, AppState gating, 300ms animation)

The core loop is now functional. A user can register, see news, place a prediction, and get notified on resolution. The next phase shifts from "make it work" to "make it sticky." These tickets target: identity/social layer, host resolution UX, discovery improvements, and platform durability.

---

## TICKET 9 — Profile Screen & User Identity
**CEO Priority:** Sprint 4 (Critical — retention)
**Complexity:** M

**Business justification:** Right now, a user has no persistent identity in the product. They can predict, but they can't see their own history, track their accuracy, or feel a sense of progress. Without a profile screen, the product has no ego hook — no reason to come back and check "how am I doing." This is the single most important retention feature missing after auth.

**What already exists:**
- `GET /api/profile/me` returns a complete profile: wallet balance, reputation score, accuracy score, level, streak, stats, badges, category stats, last 10 positions, last 6 created markets
- `apps/mobile/src/app/(tabs)/profile.tsx` — a profile screen already exists but needs review for completeness and auth wiring
- `mobileApi.getMyProfile()` exists in the api-client

**What to build:**
1. Review `apps/mobile/src/app/(tabs)/profile.tsx` — ensure it calls `mobileApi.getMyProfile()` with proper auth (no userId query param fallback)
2. Surface the following prominently: username, wallet balance (points), reputation score, accuracy score %, prediction streak, total predictions count
3. Render badge shelf (horizontal scroll of earned badges using `getBadgeMeta` logic already in the file)
4. Recent positions list: show last 10 with market title, side taken, amount, and a win/loss/pending indicator based on market status and winningSide
5. Category breakdown: show top 2-3 categories by accuracy from `categoryStats`
6. "My Markets" section: show the 6 most recent created markets with status chips (uses `/api/profile/me/markets`)
7. Sign out button that calls `session.signOut()` and clears SecureStore
8. If unauthenticated, show a prompt to sign in (same pattern as Create tab)

**Acceptance criteria:**
- Authenticated user lands on Profile tab and sees their real wallet balance, reputation score, streak, and badge shelf within one API call
- Recent positions correctly show win/loss/pending status
- Category stats are visible
- Sign out clears the session and redirects to sign-in
- The screen handles loading, error, and empty states gracefully

---

## TICKET 10 — Host Resolution Flow on Mobile
**CEO Priority:** Sprint 4 (Critical — supply-side health)
**Complexity:** M

**Business justification:** Markets cannot resolve without the host acting. Right now, a host who created a market has no in-app way to resolve it once it closes. They would need to use the web admin panel. This is a critical supply-side gap — if hosts can't easily resolve markets, trust scores degrade, bonds get forfeited, and the reputation system becomes noise. This is also the moment hosts earn commission, which is the core incentive for hosting.

**What already exists:**
- `POST /api/markets/:marketId/resolve` endpoint handles host resolution
- The market detail page (`apps/mobile/src/app/market/[id].tsx`) already shows the market and has `market.creator?.username`
- `GET /api/profile/me/markets` returns created markets
- Resolution logic in `apps/api/lib/markets/resolution.ts` handles HOST mode resolution

**What to build:**
1. In `apps/mobile/src/app/market/[id].tsx`: detect if `market.status === "CLOSED"` OR `market.status === "AWAITING_RESOLUTION"` AND `market.creator?.username === session?.username`. If true, render a "Resolve Market" panel for the host
2. For BINARY markets: show YES / NO selection, a text field for resolution notes (optional), and a "Confirm Resolution" button
3. For NUMERIC markets: show a number input for the actual value, resolution notes, and confirm button
4. POST to `/api/markets/:id/resolve` with `{ outcome: "YES"|"NO", resolutionNotes: string }` for binary, or `{ numericOutcome: number, resolutionNotes: string }` for numeric
5. On success: show a confirmation card ("Market resolved. Payouts processing."), trigger `onRefresh()` to reload market state
6. Show the host's bond amount and commission they'll earn (compute from `market.hostCommissionBps` and `market.totalVolume`) in the panel so they understand the incentive
7. Add a "Markets to Resolve" badge on the Profile tab — a small numeric badge on the tab bar icon showing count of CLOSED markets where the user is the host and hasn't resolved yet. Fetch from `/api/profile/me/markets`, filter client-side.

**Acceptance criteria:**
- Host of a CLOSED binary market sees the Resolve panel, selects YES or NO, confirms, and sees the resolution reflected (market status changes to RESOLVED or RESOLVING)
- Host of a CLOSED numeric market can enter the actual value and confirm
- Non-host users do not see the Resolve panel on any market
- The tab bar badge appears when the user has at least 1 market awaiting resolution

---

## TICKET 11 — Comments on Markets
**CEO Priority:** Sprint 4 (Important — engagement)
**Complexity:** M

**Business justification:** Markets with no discussion are dead. Comments are the lowest-cost way to create social presence around a market — they give users a reason to re-enter the market detail screen, create the "check in on the debate" loop, and surface information that improves prediction quality. Every major prediction market (Manifold, Polymarket, Kalshi) has comments as a core feature.

**What already exists:**
- `GET /api/markets/:marketId/comments` and `POST /api/markets/:marketId/comments` endpoints exist
- The comment data model is in place

**What to build:**
1. Add `getMarketComments(marketId)` and `postMarketComment(marketId, body)` methods to `packages/api-client/src/index.ts`
2. In `apps/mobile/src/app/market/[id].tsx`, below the resolution rules section, add a Comments section
3. Display comments in chronological order: avatar initial + username, comment body, timestamp (use `formatRelativeTime`)
4. Show comment count in the section header ("12 comments")
5. At the bottom: an inline text input + "Post" button. Requires authentication. Optimistically append the comment on post.
6. Maximum 500 characters per comment, show remaining counter
7. On resolved markets, comments are read-only (input is hidden, comments still shown)

**Acceptance criteria:**
- Authenticated user can read and post comments on any OPEN market from the market detail screen
- New comment appears immediately (optimistic update) without requiring a full page reload
- Comment count in the header updates after posting
- Unauthenticated users can read comments but cannot post (input shows a "Sign in to comment" message)
- Resolved markets show comments in read-only mode

---

## TICKET 12 — In-App Notification Inbox
**CEO Priority:** Sprint 4 (Important — re-engagement)
**Complexity:** S

**Business justification:** Push notifications fire-and-forget. If a user misses the push (device off, notifications off, or just dismissed it), the event is lost. An in-app notification inbox gives users a persistent place to see all lifecycle events: market resolved, you won/lost, challenge outcome, host action required. This is the re-engagement surface that brings users back to the relevant market with one tap.

**What already exists:**
- `GET /api/notifications` endpoint exists
- The Notification model is in the DB (type, title, body, marketId, isRead, createdAt)
- `apps/mobile/src/app/notifications.tsx` exists but needs review for completeness
- There is no tab bar badge for unread notifications anywhere

**What to build:**
1. Review `apps/mobile/src/app/notifications.tsx` — ensure it calls `GET /api/notifications` with auth, renders a list of notifications (type icon + title + body + time), and marks them as read
2. Add a "Mark all read" button in the header
3. Tapping a notification with a `marketId` should navigate to `/market/${marketId}`
4. Add an unread count badge to the notifications bell icon (or to the Profile tab icon — wherever it lives in `apps/mobile/src/app/(tabs)/_layout.tsx`)
5. Add `getNotifications()` and `markNotificationsRead(ids)` to `packages/api-client/src/index.ts` if missing
6. Poll for new notifications every 60 seconds while the app is in the foreground (same `useInterval` pattern as market polling)

**Acceptance criteria:**
- User can open a notification inbox and see all lifecycle notifications
- Unread notifications are visually distinct
- Tapping a notification with a marketId navigates to that market
- An unread count badge is visible on the relevant tab when there are unread notifications
- "Mark all read" clears all badges and visual indicators

---

## TICKET 13 — Market Creation: Post-Submit Flow & Draft Saving
**CEO Priority:** Sprint 5 (Important — host supply)
**Complexity:** S

**Business justification:** After a host submits a market, they get an Alert dialog and land nowhere meaningful. There is no confirmation screen, no way to navigate to their new market, and no draft saving. Hosts who spend 5 minutes filling out the 5-step wizard and then lose their progress due to an error will not try again. This is killing host supply at the very last step.

**What already exists:**
- `apps/mobile/src/app/(tabs)/create.tsx` has a full 5-step wizard with an `Alert.alert("Market Created!", ...)` on success
- Market creation already posts to `/api/markets/create` and receives `{ market: { id: string } }`
- `apps/mobile/src/lib/create-prefill.ts` exists (a prefill helper)

**What to build:**
1. After successful market creation, replace the `Alert.alert` with navigation to the new market's detail page: `router.push(`/market/${createdMarketId}`)` — the API already returns the ID
2. In the review step (StepReview), if the market is PUBLIC, add a note: "This market goes through moderation before going live. You'll be notified when it's approved."
3. Add lightweight client-side draft persistence: serialize the wizard form state to `AsyncStorage` under a `draft_market_form` key on every step advance. On mount, if a draft exists, prompt: "You have a saved draft. Continue?" Implement this with a simple `useEffect` that reads/writes draft state.
4. Add a "Clear draft" option in case the user wants to start fresh

**Acceptance criteria:**
- Successful market creation navigates directly to the new market's detail page
- The review step shows a moderation notice for PUBLIC markets
- Returning to the Create tab after partially filling the wizard shows a "Continue draft?" prompt
- The draft is cleared after successful submission or explicit user action

---

## TICKET 14 — Leaderboard Screen
**CEO Priority:** Sprint 5 (Important — virality + competitive engagement)
**Complexity:** S

**Business justification:** Social proof and competition are the two strongest forces in engagement. A leaderboard makes users want to improve their ranking, creates visible ambition ("I could be top 10"), and shows new users that expert predictors exist on the platform. The leaderboard data and API already exist — this is purely UI work.

**What already exists:**
- `GET /api/leaderboard?category=<optional>` returns top 25 users by reputation + accuracy
- `mobileApi.getLeaderboard(query)` is in the api-client
- `apps/mobile/src/app/(tabs)/leaderboard.tsx` exists — needs review for completeness

**What to build:**
1. Review `apps/mobile/src/app/(tabs)/leaderboard.tsx` — if it's a stub, build it; if it already has content, verify it correctly calls `mobileApi.getLeaderboard()` with auth
2. Render top 25 users as a ranked list: rank number (with gold/silver/bronze colors for #1/#2/#3), username, reputation score, accuracy percentage
3. Category filter tabs at the top (All, Sports, Tech, Business, General) — switching calls the API with the relevant category filter
4. Highlight the current user's row if they appear in the top 25 (compare `session?.username` against entries)
5. Show the current user's rank even if they're outside the top 25 — fetch their position from the profile data (use `reputationScore` rank as a rough approximation)

**Acceptance criteria:**
- Authenticated user sees a ranked leaderboard of top 25 users
- Category filter tabs work and reload the leaderboard for the selected category
- The current user's row is visually highlighted if they appear in the list
- Gold/silver/bronze rank indicators appear for the top 3

---

## TICKET 15 — Market Search & Discovery
**CEO Priority:** Sprint 5 (Important — activation)
**Complexity:** S

**Business justification:** The markets tab currently shows all public markets in a flat list. As volume grows, users cannot find markets relevant to their interests. Search is the foundational discovery mechanic — it's how a new user who cares about IPL cricket finds the right market without scrolling through 50 unrelated ones. The API already supports search via the `q` query param on `GET /api/markets/public`.

**What already exists:**
- `GET /api/markets/public?q=<search_term>` already supports text search on market title
- The public markets fetcher in `apps/mobile/src/app/(tabs)/markets.tsx` already passes a `sort` param
- The Markets screen has category filter pills

**What to build:**
1. In `apps/mobile/src/app/(tabs)/markets.tsx`, add a search bar (TextInput styled as a search field) above the status tabs when in "public" mode
2. Debounce the search input (300ms) and pass the query to `mobileApi.getPublicMarkets({ q: searchQuery, sort: "rank" })` when non-empty; revert to default sort when empty
3. Show a "Searching..." indicator while the debounced query is in-flight
4. When search returns 0 results, show an empty state: "No markets found for '[query]'. Try a different search."
5. Clear button on the search input (X icon, appears when input is non-empty)

**Acceptance criteria:**
- User can type in the search bar and see markets filtered to match the query within ~400ms
- Empty search reverts to the default market list
- Zero-result state is clearly communicated with the user's query shown
- Clear button resets the search and returns to the full list

---

## TICKET 16 — Web Frontend: Market Detail & Betting Parity
**CEO Priority:** Sprint 6 (Strategic — web acquisition channel)
**Complexity:** L

**Business justification:** The web app (`apps/web`) is the SEO acquisition channel. Users who find a market via Google or a shared link land on the web. If they cannot place a prediction from the web, the acquisition event fails. The web frontend has admin-level market management but no public-facing betting interface. Every share card that drives a web click needs to convert.

**What already exists:**
- `apps/web` is a Next.js app with Prisma and an admin panel
- The market route at `apps/web` likely lacks a public-facing market detail page with betting
- The shared packages (`packages/business-rules`, `packages/types`, `packages/validation`) are already set up for web use
- The API client can be used from Next.js via server components

**What to build:**
1. Create `apps/web/app/markets/[id]/page.tsx` — a public-facing market detail page accessible without authentication
2. Display: market title, description, YES/NO probability bar, volume, participant count, close/resolve time, host info
3. For OPEN markets: show a betting panel. Unauthenticated users see a "Sign in to predict" prompt linking to web auth. Authenticated users see the full YES/NO side selection + amount input + estimated return + Place Bet button (POST to `/api/markets/:id/positions`)
4. For RESOLVED markets: show the outcome, the user's position (if any), and payout received
5. Web auth: implement `apps/web/app/(auth)/sign-in/page.tsx` using email/password (POST to `/api/auth/register` / `/api/auth/mobile/login` — these endpoints already handle both web and mobile sessions via cookie vs. Bearer depending on the caller)
6. Deep link from share cards: `Share.share` on mobile currently sends text-only; update the message to include `https://predictfuture.app/markets/${marketId}` so the web URL is the landing destination

**Acceptance criteria:**
- Unauthenticated user can view a market detail page on the web (title, probability, stats)
- Authenticated web user can place a YES/NO bet and see their position confirmed
- The page is server-side rendered (Next.js) and includes correct `<title>` and `<meta>` tags for social sharing
- Deep links from the mobile share feature resolve to the correct web URL

---

## Delivery Sequencing

**Sprint 4 (Parallel):** Tickets 9, 10, 11, 12 — all depend only on Sprint 1-3 auth being complete, which it is. Run in parallel across two engineers or sequence by impact: 9 (Profile) → 12 (Notifications) → 10 (Host Resolve) → 11 (Comments).

**Sprint 5 (After Sprint 4 ships):** Tickets 13, 14, 15 — quick wins. Sprint 4 ships first so that the Profile screen (Ticket 9) validates auth behavior before these screens depend on it.

**Sprint 6 (Strategic):** Ticket 16 (Web parity) is the longest ticket and can be scoped as its own sprint. It is independent of the mobile tickets and can be assigned to a dedicated engineer while mobile work continues.

---

## CEO Message to CTO

The engine is running. We have real users, real auth, real predictions, and real notifications. The foundation sprint delivered everything it promised.

The work ahead is about earning the right to spend money on user acquisition. Before we put a single dollar into marketing, I need three additional things to be true:

1. A user can come back to the app tomorrow and immediately see what happened to their predictions — their wins, their losses, their balance. That's Ticket 9.

2. A host can resolve their markets from the phone — without touching a web browser or admin panel. If hosting requires a laptop, it won't happen at scale. That's Ticket 10.

3. A web user who follows a share link can place a prediction without downloading the app. That's Ticket 16, and it's the hardest one — save it for Sprint 6 when you have the mobile UX validated as a reference.

The middle tickets (11, 12, 13, 14, 15) are all multipliers on engagement — each one adds a meaningful reason to re-open the app. But don't sacrifice Profile (9) and Host Resolve (10) to build Comments (11). Sequence matters.

The 90-day milestone is: 100 markets created by real hosts, 1,000 predictions placed, top-10 users on the leaderboard visible to everyone. Every ticket in this sprint contributes to one of those three numbers.
