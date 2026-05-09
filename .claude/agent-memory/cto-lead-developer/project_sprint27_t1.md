---
name: Sprint 27 T1 — Today's Big Call
description: S27-T1 Big Call daily market: schema fields, admin route, cron push, GET endpoint, mobile card, types, api-client — COMPLETE
type: project
---

Schema additions on Market (prisma db push applied):
- `isBigCallDate DateTime?` — stored as IST midnight UTC (Date.UTC(y,m,d) minus 5.5h offset)
- `bigCallNotificationSentAt DateTime?` — idempotency guard for cron double-send
- `bigCallNotificationOpenedCount Int @default(0)` — tap analytics
- `@@index([isBigCallDate])` — for efficient daily lookup

Routes created:
- `apps/api/app/api/admin/markets/[marketId]/mark-big-call/route.ts` — POST, ADMIN role, optional `{ date?: "YYYY-MM-DD" }` body, clears old Big Call for same day, sets isBigCallDate, resets sentAt
- `apps/api/app/api/cron/big-call-push/route.ts` — POST, CRON_SECRET bearer guard, cursor-paginates users in batches of 500, sends Expo push in chunks of 100, marks sentAt on completion
- `apps/api/app/api/markets/today-big-call/route.ts` — GET, no auth, Cache-Control: public max-age=60
- `apps/api/app/api/markets/[marketId]/big-call-tap/route.ts` — POST, no auth, atomically increments count, always returns 200

IST date range for queries: `dayStartUtc = Date.UTC(y, m-1, d) - istOffsetMs`, `dayEndUtc = dayStartUtc + 24h`
Same pattern as tip route and quest engine — reuse `getIstDateString()` from `lib/quests/engine.ts`

API client: `getTodayBigCall()`, `trackBigCallOpened(marketId)`, `markMarketAsBigCall(marketId, date?)`
Types: `ApiBigCallMarket`, `ApiBigCallResponse` added to `packages/types/src/index.ts`

Mobile (feed.tsx):
- `BigCallCard` component defined at module scope in feed.tsx (not a separate file — kept co-located)
- State: `bigCallMarket: ApiBigCallMarket | null | undefined` (null=loading, undefined=no market)
- Fetched once on mount via useEffect, no-auth
- Renders between PlatformTrustBanner and FlatList — uses `bigCallMarket != null` guard
- Tap: fires trackBigCallOpened fire-and-forget then router.push(`/market/${id}`)

**Why:** The `undefined` vs `null` distinction allows "loading" (null) vs "no market set today" (undefined) distinction for the conditional render guard `bigCallMarket != null`.

**How to apply:** For future Big Call analytics or admin UI, reference `isBigCallDate` as IST midnight UTC; the mark-big-call route handles the conversion. The cron should be scheduled at 02:30 UTC = 8:00 AM IST.
