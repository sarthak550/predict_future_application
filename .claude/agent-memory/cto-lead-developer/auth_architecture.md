---
name: Mobile Auth Architecture (Sprint 1 Ticket 1)
description: Decisions and follow-up items from wiring real mobile auth end-to-end (SecureStore, SessionProvider, api-client signIn/register)
type: project
---

## What was built (2026-05-01)

Implemented real end-to-end auth for the Expo mobile app, replacing the `EXPO_PUBLIC_DEMO_USER_ID` scaffold.

### Files changed
- `packages/api-client/src/index.ts` — added `signIn({ email, password })` and `register({ username, email, password })` methods calling `/api/auth/mobile/login` and `/api/auth/mobile/register`
- `apps/mobile/src/providers/session-provider.tsx` — full rewrite: `Session` now includes `{ userId, username, token }`, `SessionState` exposes `signIn`, `signOut`, `isNewUser`; cold-launch restoration from SecureStore; exports `getSessionToken()` helper
- `apps/mobile/src/lib/api.ts` — `mobileApi` now passes `getAuthToken: () => SecureStore.getItemAsync("session_token")` at module level (no React context needed)
- `apps/mobile/src/app/index.tsx` — gates auth: unauthenticated → `/(auth)/sign-in`, loading → null (no flash), authenticated → `/(tabs)/feed`
- `apps/mobile/src/lib/env.ts` — removed `demoUserId` field entirely
- All screen files: removed `{ userId: env.demoUserId }` query params from all API calls (feed, markets, market detail, news-feed-card)
- `apps/mobile/src/app/(tabs)/create.tsx` — removed `EXPO_PUBLIC_DEMO_USER_ID` reference from unauthenticated state message

### Key architectural decisions

1. **SecureStore read at request time, not at module init**: `getAuthToken` is a closure over `SecureStore.getItemAsync("session_token")` — called fresh on every authenticated request. This avoids stale token issues with a module-level singleton and doesn't need React context.

2. **SecureStore keys**: Three separate keys: `session_token`, `session_user_id`, `session_username`. All must be present for a valid restored session; missing any one causes unauthenticated state.

3. **`isNewUser` flag**: Set when `signIn` is called with `isNew: true`. Used to gate onboarding redirect in `index.tsx`. Currently not used (Ticket 3 will wire it to `/onboarding`). The flag is `false` by default and resets on `signOut`.

4. **`getSessionToken()` export**: Async helper that reads `session_token` from SecureStore — available for any non-React code that needs the token.

### Technical debt / follow-up items

- **Ticket 3 (onboarding)**: When onboarding route is built, add `if (isNewUser) return <Redirect href="/onboarding" />` in `apps/mobile/src/app/index.tsx`
- **Token expiry handling**: JWT has 30-day expiry. Currently no refresh logic — if the stored token expires, API calls will fail with 401. Follow-up ticket needed for token refresh or graceful re-auth prompt.
- **Pre-existing TS errors**: `sports.tsx`, `notifications.tsx`, `prediction-card.tsx`, `create-prefill.ts` all have pre-existing TypeScript errors (unrelated to auth). `markets.tsx` has a pre-existing `MarketMode` type narrowing issue where `"polls"` mode is used but was not in the union. These should be cleaned up in a separate ticket.
- **markets.tsx `MarketMode`**: The type is `"public" | "private"` in the committed HEAD but the working tree already had `"polls"` added and compares against it. The TS errors at lines 251/254 are from this pre-existing mismatch.

**Why:** CEO priority is shipping real auth as the critical blocker for Sprint 1. Demo user scaffold was blocking all downstream personalization work.

**How to apply:** Any new authenticated API call in mobile should not pass `userId` as a query param — identity comes from the Bearer token on the server side. The server-side `getUserIdFromRequest` pattern handles token extraction.
