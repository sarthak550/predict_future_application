---
name: project_sprint61
description: Sprint 61 RBI Pulse backend — pure reuse build, no schema migration, 4 tickets implemented
metadata:
  type: project
---

Sprint 61: RBI Pulse — backend complete.

**Why:** Add RBI MPC poll-pack feature (poll-pack = cluster + 2 MULTIPLE_CHOICE markets) without any schema migration, reusing existing `MarketEventCluster`, `MULTIPLE_CHOICE`, `MarketOption`, `structuredData`, `flagshipEventType`, and `settleMultiChoiceMarket()`.

**Files created/modified:**

- `apps/api/app/api/admin/rbi/mpc-pack/route.ts` — T0: POST creates cluster + 2 markets in one transaction
- `apps/api/app/api/admin/rbi/mpc-pack/[clusterId]/resolve/route.ts` — T3: POST resolves both markets, calls settleMultiChoiceMarket()
- `apps/api/app/api/finance/flagship-events/route.ts` — T4: added structuredData + eventClusterId to response payload
- `packages/types/src/index.ts` — T4+T6: added structuredData to ApiMarketSummary + ApiFlagshipEvent; added ApiMpcPollMarket, ApiMpcPollPack types and groupFlagshipEventsIntoPacks() helper

**Key reuse decisions:**
- Auth pattern: same `requireAdmin()` helper as event-clusters route (getUserIdFromRequest + role check)
- Market creation: same field set as admin/flagship-events/route.ts (no bond, no wallet deduction, free votes)
- Resolution: exact same DB update shape as /api/markets/[marketId]/resolve-multi-choice + settleMultiChoiceMarket()
- Idempotency: T3 skips already-resolved markets (winningOptionId non-null check)

**How to apply:** If extending RBI Pulse, follow the same reuse pattern. Do NOT add new schema fields without stopping first.
