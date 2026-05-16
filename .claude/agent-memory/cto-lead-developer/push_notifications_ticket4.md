---
name: push_notifications_ticket4
description: Sprint 1 Ticket 4: Expo push notifications for market lifecycle events — schema, API endpoint, resolution hook, mobile registration
type: project
---

Push notification delivery added for market finalization events (COMPLETE).

**Why:** Users need to know when a market they participated in resolves without having to open the app.

**How to apply:** When working on notification-related features, push delivery is always fire-and-forget after the DB transaction commits — never inside a Prisma transaction.

## What was built

### Schema change
- Added `expoPushToken String?` to `model User` in `apps/api/prisma/schema.prisma` (after `reputationScore`)
- `prisma generate` must be run after schema changes — the Prisma client was regenerated in this ticket
- `prisma db push` requires `DATABASE_URL` env var; `apps/api` has no local `.env` — needs symlink from root or explicit DATABASE_URL export

### API — push token endpoint
- `apps/api/app/api/users/push-token/route.ts` — `POST /api/users/push-token`
- Auth: Bearer JWT (same pattern as `/api/auth/mobile/login/route.ts`) — extracts `sub` from JWT payload
- Validates token format with regex: `ExponentPushToken[...]` or native 20+ char alphanumeric
- Does `prisma.user.update` (not upsert — user must already exist, guaranteed by auth)
- Returns `{ ok: true }` — idempotent

### API — resolution hook
- `apps/api/lib/markets/resolution.ts` — `finalizeMarketResolution` was refactored
- Transaction result is now captured (`const market = await prisma.$transaction(...)`) instead of being returned directly
- `sendExpoPushNotifications(participantIds, title, resolutionStatus)` is called **after** transaction commits using `void ...catch()`
- `sendExpoPushNotifications` is a module-private async function — fetches push tokens via `prisma.user.findMany` (not tx), batches 100 per Expo push request
- Push failures never crash or roll back the resolution transaction

### API client
- Added `registerPushToken(body: { token: string })` to `packages/api-client/src/index.ts`
- Uses `auth: true` so the Bearer token is attached automatically

### Mobile
- Installed `expo-notifications@^55.0.21` in `apps/mobile`
- `apps/mobile/src/app/_layout.tsx` — added `PushTokenRegistrar` component
  - Lives inside `<AppProviders>` so it has access to `useSession()`
  - Effect deps on `session?.userId` so it fires once per authenticated session
  - Skipped on `Platform.OS === "web"`
  - Requests permissions → gets token → POSTs to `/api/users/push-token` via `mobileApi`
  - All failures swallowed silently — never blocks navigation

## Known constraints
- `prisma db push` blocked by missing `.env` in `apps/api` — DATABASE_URL must be provided externally or via symlink to root `.env`
- Pre-existing TypeScript errors in `sports.tsx`, `markets.tsx`, `notifications.tsx`, `create.ts` — none introduced by this ticket
