---
name: S27-T2 Probability Chart Over Lifetime
description: S27-T2 consensus-line chart — MarketProbabilitySnapshot model, cron, position wiring, history API, mobile View chart (COMPLETE)
type: project
---

S27-T2 COMPLETE — Probability chart over market lifetime (consensus-line).

**Key files:**
- Schema: `apps/api/prisma/schema.prisma` — `MarketProbabilitySnapshot` model + `probabilitySnapshots` inverse on Market
- Computation lib: `apps/api/lib/markets/probabilitySnapshot.ts` — `computeMarketProbability()` + `recordProbabilitySnapshot()`
- Cron lib: `apps/api/lib/crons/probability-snapshot.ts` — `snapshotMarketProbabilities()` with 7-day retention policy
- Cron route: `apps/api/app/api/cron/probability-snapshot/route.ts` — POST, CRON_SECRET bearer guarded
- History route: `apps/api/app/api/markets/[marketId]/probability-history/route.ts` — GET, no auth, Cache-Control: public max-age=300
- Types: `packages/types/src/index.ts` — `ApiProbabilitySnapshot`, `ApiProbabilityHistory`
- API client: `packages/api-client/src/index.ts` — `getProbabilityHistory(marketId)`
- Mobile: `apps/mobile/src/app/market/[id].tsx` — `ProbabilityChart` component + `probHistory` state in `MarketBody`

**Architectural decisions:**
- `computeMarketProbability` accepts `PrismaClient | Prisma.TransactionClient` — usable both fire-and-forget (outside tx) and inside tx
- BINARY: probability = yesPositionCount / totalPositionCount (position-based, not pool-based) — matches ticket AC
- MULTIPLE_CHOICE: probability = highest option's totalStaked / sum of all options' totalStaked
- NUMERIC: returns null — skipped
- Position routes (binary + multi-choice) both fire `void recordProbabilitySnapshot()` outside transaction
- 7-day retention: old snapshots compressed to 1 per UTC calendar day (last snapshot of day kept); runs at end of each cron execution
- History aggregation: <= 7 day old market gets all hourly points; older markets get daily aggregates
- Resolved markets get `resolvedProbability: 1.0 (YES) | 0.0 (NO)` appended to the API response
- Mobile chart: pure View segments, no react-native-svg (not in package.json); line drawn using rotate transform on thin Views

**Why:** Press/engagement hook — show community opinion shift over time (Polymarket parity).
**How to apply:** When touching market position routes, ensure the `void recordProbabilitySnapshot()` fire-and-forget is preserved outside the tx block.
