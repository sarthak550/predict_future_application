---
name: CTO Assignment Brief — Sprint 1-3 Tickets
description: Formal engineering tickets written by CEO for CTO/Lead Dev, covering 8 prioritized tasks from the 2026-05-01 product audit. Delivery sequence, acceptance criteria, and complexity estimates included.
type: project
---

# CTO Assignment Brief — Predict Future
**Issued:** 2026-05-01
**From:** CEO
**To:** CTO / Lead Developer

---

## TICKET 1 — Wire Real Mobile Auth End-to-End
**CEO Priority:** Sprint 1 (Critical Blocker)

**Business justification:** Every mobile user currently operates as the same hardcoded demo user. No real user accounts, no real data, no acquirable users. This is the single most important thing to fix before any user acquisition effort.

**Technical context:**
- Auth screens already exist and are functional UI: `apps/mobile/src/app/(auth)/sign-in.tsx` and `apps/mobile/src/app/(auth)/sign-up.tsx`
- Both screens call `mobileApi.signIn(...)` and `mobileApi.register(...)` and expect a `signIn({ userId, username, token })` on `useSession()` — but NONE of these methods exist yet
- The API endpoints are fully built: `POST /api/auth/mobile/login` and `POST /api/auth/mobile/register` (in `apps/api/app/api/auth/mobile/`)
- The session provider at `apps/mobile/src/providers/session-provider.tsx` is a scaffold — it only reads `env.demoUserId` and does not expose a `signIn` function
- The api-client at `packages/api-client/src/index.ts` has no `signIn` or `register` methods
- The mobile app's root index at `apps/mobile/src/app/index.tsx` unconditionally redirects to `/(tabs)/feed` — there is no auth gate

**What needs to be built:**
1. Add `signIn(email, password)` and `register(username, email, password)` methods to `packages/api-client/src/index.ts` calling the existing mobile auth endpoints
2. Extend `SessionProvider` to: expose a `signIn({ userId, username, token })` function, persist the JWT to `expo-secure-store` (or `AsyncStorage` as fallback), read the stored token on cold start, expose the token via `getAuthToken` for authenticated API calls
3. Extend `Session` type to include `token: string` and `username: string`
4. Update `apps/mobile/src/lib/api.ts` to pass `getAuthToken` from the session to `createApiClient` so Bearer tokens are sent on authenticated requests
5. Update `apps/mobile/src/app/index.tsx` to redirect unauthenticated users to `/(auth)/sign-in` instead of the feed
6. Remove all `{ userId: env.demoUserId }` query params across `apps/mobile/src/app/` — replace with auth headers (the API already accepts Bearer tokens and falls back to the `userId` query param as legacy; once tokens are wired, the query param fallback can be dropped)

**Acceptance criteria:**
- A new user can register with username + email + password on mobile, land on the feed, and have their own points balance (starting balance from constants)
- A returning user can sign in, and their session persists across app restarts (cold launch goes to feed, not sign-in)
- Sign out clears the stored token and redirects to sign-in
- All API calls from the mobile app send `Authorization: Bearer <token>` on authenticated routes
- `EXPO_PUBLIC_DEMO_USER_ID` is no longer required to use the app — the env var can be absent
- Two different devices running the app see two different user accounts

**Estimated complexity:** M

---

## TICKET 2 — Complete Mobile Market Detail Page
**CEO Priority:** Sprint 1 (Critical Blocker)

**Business justification:** The core loop of the product is: see news, make a prediction, watch it resolve. The market detail page is the place where the prediction is made. Without it working, the product has no core loop on mobile.

**Technical context:**
- Contrary to the original assessment, `apps/mobile/src/app/market/[id].tsx` is NOT a stub — it is a substantially complete implementation with probability display, YES/NO side selection, amount presets, bet placement, numeric market support, poll voting, and position display
- The file is wired to `mobileApi.getMarketById`, `mobileApi.placePosition`, and `mobileApi.castVote`
- The issue is that all three calls pass `{ userId: env.demoUserId }` — they will break or misattribute once Ticket 1 is done and the demo userId is removed
- Specifically: `calculateEstimatedReturn` from `packages/business-rules/src/markets/probability.ts` is NOT surfaced on the detail page — users cannot see expected payout before placing a bet
- The page also has no navigation back to the originating news story

**What needs to be built:**
1. After Ticket 1: remove the `{ userId: env.demoUserId }` calls — the API will use the Bearer token from the session instead
2. Add an "Estimated return" line to the betting panel. Use `calculateEstimatedReturn(side, amount, yesPool, noPool)` from `packages/business-rules/src/markets/probability.ts` — compute and display inline as the user selects amount
3. Add a "Back to story" link/button if the market has a `storyId` (poll markets) — this surfaces the news context
4. Verify the full betting flow works end-to-end with real auth: place bet, see position, see updated probability, re-enter market and see existing position

**Acceptance criteria:**
- Authenticated user can open any OPEN market from the feed, see the current YES/NO probability, select a side, see estimated return for their chosen amount, confirm, and see their position reflected
- Returning to a market where the user has a position shows the existing position correctly
- Numeric market guess submission works for authenticated users
- Poll vote submission works for authenticated users
- A closed or resolved market shows the correct status and blocks further betting

**Estimated complexity:** S (primarily unlocked by Ticket 1; incremental work is the estimated return display)

---

## TICKET 3 — Mobile Onboarding Flow
**CEO Priority:** Sprint 1 (Critical Blocker)

**Business justification:** Users arriving at the feed without understanding virtual points, prediction markets, or the host system will not engage. D1 retention is currently undefined — there is no mechanism to guide new users to their first prediction. This is the lowest-cost, highest-impact retention lever available.

**Technical context:**
- No onboarding screen exists in the mobile app
- The register endpoint at `apps/api/app/api/auth/mobile/register/route.ts` already sends a "Welcome!" in-app notification to new users on account creation — this is a hook point
- The session provider will, after Ticket 1, know whether a user is new (first login after registration) vs returning
- The sign-up screen already explains "Free virtual points. No deposits, no risk." — this is the right tone

**What needs to be built:**
1. Create an onboarding flow (3-4 screens max, swipeable) that fires once for new users immediately after successful registration:
   - Screen 1: What is Predict Future? — "Make predictions on news. Virtual points only. No money required."
   - Screen 2: How it works — "Pick YES or NO on a question. If you're right, you win points from the pool."
   - Screen 3: Become a Host — "Create your own markets. Build your reputation. Unlock Trusted Host status." (show the 3 eligibility bars as a teaser — account age, finalized markets, trust score — pre-populated at 0/target so users understand the journey on day 1)
   - Screen 4 (optional): First prediction prompt — deep link directly into the markets list with a "Make your first prediction" CTA
2. Store a boolean flag in SecureStore (`onboarding_complete`) so the flow only shows once per device/account
3. Trigger it from the index redirect logic: if `isNewUser` flag is set in session (set during registration flow), redirect to `/onboarding` instead of `/(tabs)/feed`

**Acceptance criteria:**
- New users see the onboarding flow exactly once after creating an account
- Returning users (subsequent cold launches) go directly to the feed, never see onboarding again
- Onboarding screens load with no API calls required (static content + points balance from session context)
- The host eligibility teaser on Screen 3 shows 0/14 days, 0/2 markets, 0/55 trust score as placeholder bars
- A "Skip" button is available on every screen so users are never trapped

**Estimated complexity:** S

---

## TICKET 4 — Push Notifications for Market Lifecycle Events
**CEO Priority:** Sprint 2 (Important)

**Business justification:** Without notifications, users must return to the app proactively to learn if their prediction resolved. This is a critical re-engagement mechanism — prediction resolution is the highest-intent moment in the product lifecycle, the moment users feel the reward or loss of their prediction.

**Technical context:**
- The in-app notification infrastructure is complete: `apps/api/lib/notifications.ts` has `createNotification` and `notifyMany`, the DB schema has a Notification table, and the API already routes in-app notifications
- What is completely absent: Expo Push Token registration on mobile, storage of push tokens per user in the DB, and calls to Expo's push notification API at market resolution
- The resolution logic lives in `apps/api/lib/markets/resolution.ts`
- Notification trigger moments: market resolved (all participants), challenge outcome (challenger + host), host resolution required (host only)

**What needs to be built:**
1. DB: Add `expoPushToken` field (nullable string) to the User model in `prisma/schema.prisma`
2. API: Add `POST /api/users/push-token` endpoint — accepts `{ token: string }`, validates it as an Expo push token format, writes to the user record
3. Mobile: On app launch (after auth), call `Notifications.getExpoPushTokenAsync()` (from `expo-notifications`), request permissions if not granted, POST the token to the new endpoint
4. API: In `apps/api/lib/markets/resolution.ts`, after market resolution, fetch the push tokens of all participants and call Expo's push API (`https://exp.host/push/send`) with a notification: "Your prediction on [market title] has resolved — [result]"
5. API: Notify the host when HOST_RESOLVED mode requires their action (market closed, pending resolution)
6. Do not send a push notification if the user has no stored push token — degrade gracefully to in-app notification only

**Acceptance criteria:**
- A user who grants notification permission on first launch has their Expo push token stored in the DB
- When a market resolves, all participants who have a stored push token receive a push notification within 60 seconds of resolution
- When a HOST_RESOLVED market closes without the host having resolved it, the host receives a push notification
- Push token registration is idempotent (re-registering the same token on the same user does not error)
- Notification delivery failures from Expo are logged but do not crash the resolution transaction

**Estimated complexity:** M

---

## TICKET 5 — Social Share Card for Market Results
**CEO Priority:** Sprint 2 (Important)

**Business justification:** The only viral loop currently in the product is word of mouth. A shareable result card — showing what the user predicted, whether they won, and how much they earned — turns every resolved market into a potential acquisition event. This is how prediction market apps get organic installs.

**Technical context:**
- No sharing functionality exists anywhere in the mobile app
- React Native's `Share` API (from `react-native`) requires no third-party dependency and supports both Android and iOS
- Expo's `expo-view-shot` can capture a View as an image for rich share cards
- The market detail page already renders probability and position data — the raw material for a share card is already on screen
- The API already returns `market.resolutionValue`, `market.status`, user's position side and amount, and calculated payout on resolved markets

**What needs to be built:**
1. Create a `ShareCard` component: a styled View (not visible in main UI) that renders: market title, user's prediction side, result (correct/incorrect), points earned/lost, and the Predict Future branding + app store link
2. Add a "Share Result" button to the market detail page — visible only when the market is resolved AND the user has a position
3. On tap: use `expo-view-shot` to capture the ShareCard as a PNG, then pass to `Share.share({ url: imagePath, message: 'I predicted...' })`
4. For markets that are still open, offer a simpler "Share this market" option using `Share.share({ message: marketTitle + ' — make your prediction: [app link]' })` — text only, no image

**Acceptance criteria:**
- On a resolved market where the user has a position, a "Share Result" button appears
- Tapping it opens the native share sheet with a rendered card image
- The card image shows: market title (truncated if needed), user's side (YES/NO), win/loss indicator, and points delta
- The share text includes a call-to-action pointing to the app
- The button is not present on open markets or on markets where the user has no position (use text-only sharing for open markets)

**Estimated complexity:** S

---

## TICKET 6 — Surface Host Eligibility Progress to Users
**CEO Priority:** Sprint 2 (Important)

**Business justification:** The host system is the product's primary supply-side mechanism — hosts create markets, markets drive engagement. But new users cannot see how close they are to becoming a trusted host. The progress data already exists in the API; not showing it means we are actively hiding the engagement ladder from the users who most need to see it.

**Technical context:**
- `evaluateHostEligibility` in `packages/business-rules/src/hosts/trust.ts` returns a `progress` object with 5 criteria, each as `{ current, target }`:
  - `accountAgeDays` (target: 14 days by default)
  - `validFinalizedHostedMarkets` (target: 2)
  - `hostTrustScore` (target: 55)
  - `recentHostTimeoutCount` (max allowed)
  - `overturnedHostedMarketsCount` (max allowed)
- The `GET /api/hosts/eligibility` endpoint already returns this data (see `packages/api-client/src/index.ts`: `getHostEligibility()`)
- There is a Create tab in the mobile app (`apps/mobile/src/app/(tabs)/create.tsx`) — this is where host eligibility progress belongs
- The `ApiHostEligibility` type in `packages/types/src/index.ts` already includes the `progress` field

**What needs to be built:**
1. In `apps/mobile/src/app/(tabs)/create.tsx`: call `mobileApi.getHostEligibility()` on mount (authenticated)
2. Render a "Your Host Progress" section with a progress bar for each of the 3 positive criteria (account age, finalized markets, trust score). Show `current / target` with a percentage fill
3. For the 2 penalty criteria (`recentHostTimeoutCount`, `overturnedHostedMarketsCount`), show a simple status indicator (green check if at 0, warning if approaching limit)
4. If `eligible: true`, show a "You are eligible to host!" banner with a CTA to create a market
5. If not yet eligible, show which criteria are blocking (use the `reasonCodes` array from the response) with a plain-language explanation of each blocker

**Acceptance criteria:**
- Authenticated user sees their host eligibility progress on the Create tab with no additional navigation required
- All 5 criteria are displayed with current vs. target values
- Progress bars reflect real data from `GET /api/hosts/eligibility`
- When a user meets all criteria, the page shows eligibility confirmation and a "Create Market" CTA
- When criteria are not met, blocked criteria are clearly labeled with the reason

**Estimated complexity:** S

---

## TICKET 7 — Group Prediction Leagues
**CEO Priority:** Sprint 3 (Strategic)

**Business justification:** Standalone markets are one-off events. Groups allow a host to bundle related markets (EPL matchday, Oscar predictions, earnings week) into a recurring weekly experience — this is the mechanism for habit formation. Groups are the path from casual app to weekly ritual.

**Technical context:**
- The groups infrastructure already exists in the API: `apps/api/app/api/groups/` has endpoints for create, join, and fetch
- `mobileApi` already has `getMyGroups`, `createGroup`, `joinGroup`, and `getGroupById`
- The mobile markets tab (`apps/mobile/src/app/(tabs)/markets.tsx`) already fetches and renders groups
- What is missing: a group detail view that lists its markets together, the ability to launch all group markets simultaneously, and the ability to resolve them collectively at matchday end
- The DB schema already has a `Group` model with `inviteCode` — this confirms groups are scoped/private by default

**What needs to be built:**
1. Create a `GroupDetailScreen` at `apps/mobile/src/app/group/[id].tsx` that shows: group name, member count, all markets within the group (open + resolved), and group-level aggregate stats (total volume, top predictor)
2. Add a "Start Matchday" action for group hosts: bulk-opens all draft markets in the group simultaneously (new API endpoint: `POST /api/groups/:id/launch`)
3. Add a "Resolve Matchday" view for group hosts: shows all CLOSED markets pending resolution in one list so the host can resolve them in sequence without leaving the group context
4. Surface group invite code prominently (copy-to-clipboard button) so hosts can recruit members

**Acceptance criteria:**
- Group host can create a group, add 3+ markets to it in draft state, then launch all of them at once
- Group members see all group markets in the group detail view, can tap into any market to place predictions
- After matchday, group host can navigate to a "Resolve Matchday" view and resolve each market in sequence
- Invite code is copyable from the group detail view
- Non-members cannot see group markets (privacy enforced at API level — verify existing behavior)

**Estimated complexity:** L

---

## TICKET 8 — Real-Time Probability Updates on Market Detail
**CEO Priority:** Sprint 3 (Strategic)

**Business justification:** A static probability snapshot creates a dead interface. Showing probability change in real time as other users vote creates urgency and social proof — "the crowd is moving toward YES" is a powerful behavioral nudge that increases position size and re-engagement.

**Technical context:**
- The probability math is complete in `packages/business-rules/src/markets/probability.ts`: `calculateProbabilities(yesPool, noPool)` and `calculateEstimatedReturn(side, amount, yesPool, noPool)`
- The market detail page already computes and displays `yesProbability` from `yesPool / (yesPool + noPool)` — this is locally correct but does not update unless the user explicitly pulls to refresh
- The API does not currently have a WebSocket or SSE endpoint for live market updates
- Polling is the pragmatic first implementation — a 15-second poll on the market detail page would be sufficient for v1 and requires zero new infrastructure

**What needs to be built:**
1. Add a polling mechanism to the market detail page: re-fetch market data every 15 seconds while the screen is in focus (use React Native's `AppState` and a `useInterval` hook or `useFocusEffect` from Expo Router)
2. Add a subtle animated pulse or "LIVE" indicator to the probability bar when the market is OPEN and auto-refreshing
3. When a new fetch returns updated pool sizes that differ from the previous fetch, animate the probability bar from old value to new value (React Native `Animated` — 300ms ease-in-out)
4. Pause polling when the app goes to background (check `AppState`)
5. Future consideration (Sprint 4+): replace polling with SSE from the API for true real-time updates

**Acceptance criteria:**
- While on an open market's detail screen, the probability bar updates without user interaction within 20 seconds of another user placing a bet (in a test with two devices)
- The probability bar animates smoothly between old and new values when an update arrives
- Polling stops when the user navigates away from the screen or puts the app in the background
- A "LIVE" or animated indicator is visible on OPEN markets to communicate that data is updating
- The polling does not cause visible jank or impact the betting interaction

**Estimated complexity:** S

---

## Delivery Sequencing Note

**Ticket 1 (Auth) must be completed before anything else.** Tickets 2, 3, 4, 5, and 6 all depend on a real authenticated user session. Specifically:
- Ticket 2 (Market Detail) is already functionally complete in the UI but breaks without real auth — it is the first thing to verify end-to-end after Ticket 1 ships
- Ticket 3 (Onboarding) requires knowing whether a user is new, which requires the registration flow from Ticket 1
- Ticket 6 (Host Progress) calls an authenticated endpoint — no auth, no data
- Ticket 4 (Push Notifications) requires a user record to associate the push token with — no auth, no user

**Recommended Sprint 1 sequence:** Ticket 1 → Ticket 2 (verify) → Ticket 3

**Sprint 2 can run Tickets 4, 5, and 6 in parallel** — they do not depend on each other, only on Ticket 1 being complete.

**Sprint 3 (Tickets 7 and 8) have no cross-dependencies** — they can be built in parallel or sequenced by available engineering capacity.

---

## CEO Message to CTO

We have a product that is architecturally sound and strategically differentiated. The news-first feed is genuinely well-executed, the host trust system is a real moat, and the business-rules package reflects serious product thinking. 

But right now we cannot acquire a single real user. The mobile app is a demo.

In 30 days, I need three things to be true:
1. A person can download the app, create an account, and make a real prediction that is attributed to them personally
2. That person understands within 60 seconds what virtual points are and why they should care about becoming a host
3. When their first prediction resolves, they get a notification that brings them back

Everything else is secondary to those three outcomes. Tickets 1, 2, and 3 are the entire 30-day mandate. Ship them cleanly. Do not start Ticket 4 until a real user can complete the core loop.

I will be measuring: new account registrations on mobile, percentage of new users who place at least one prediction within their first session, and D1 retention rate. None of those numbers exist today because the auth doesn't work. Fix that first.

The 60-day milestone adds push notifications (Ticket 4), social sharing (Ticket 5), and host progress visibility (Ticket 6). Together these form the full engagement flywheel: predict, get notified, share your result, grind toward host status.

The 60-day milestone is when we evaluate whether the product is ready for its first real marketing spend.
