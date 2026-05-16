---
name: Sprint 27 complete — Engagement & Retention
description: S27 all 2 tickets done 2026-05-09; probability chart architecture notes
type: project
---

Sprint 27 passed QA on 2026-05-09. Both tickets done.

**S27-T1**: Today's Big Call — CRON_SECRET guard pattern, isBigCallDate field, GET /api/markets/big-call/today, big-call-push cron.

**S27-T2**: Probability Chart Over Lifetime
- MarketProbabilitySnapshot model in schema with @@index([marketId, snapshotAt]) composite.
- computeMarketProbability returns null for NUMERIC (skipped entirely), count ratio for BINARY, highest-stake option ratio for MULTIPLE_CHOICE.
- BINARY formula: yesCount / total with 0.5 prior when total == 0. No Laplace smoothing — simple ratio.
- Fire-and-forget snapshot wiring: both binary positions route (route.ts line 336) and multi-choice positions route (route.ts line 174) use `void recordProbabilitySnapshot(params.marketId, prisma).catch(...)` OUTSIDE the transaction. Correctly wired.
- CRON_SECRET guard: checks `request.headers.get("Authorization") !== "Bearer ${expectedSecret}"` — also rejects when CRON_SECRET env is not set.
- Retention algorithm: ascending order + last-write-wins into keepIds Set. Correct.
- History aggregation: market age <= 7 days returns all hourly; > 7 days returns last snapshot per UTC calendar day (dayMap last-write-wins). Correct.
- Resolved markets: outcome === "YES" → 1.0, anything else (NO, CANCELLED, UNRESOLVED) → 0.0. Minor: CANCELLED gets 0.0 but this is acceptable for chart purposes.
- ProbabilityChart component: pure View segments with rotate transform. No charting lib imports. Only @expo/vector-icons, expo-router, react-native, react-native-safe-area-context — all in package.json.
- Chart only renders for BINARY with >= 2 snapshots. Empty state ("Probability history not yet available") shown otherwise.
- Cache-Control: public, max-age=300 confirmed on history endpoint.
- getProbabilityHistory in api-client has no auth:true (correct — public endpoint).
- TypeScript: all packages clean.
- API server was not running at review time — runtime checks skipped.

**How to apply**: For future snapshot/history features: always verify the retention algorithm ordering direction (ASC + last-write = last snapshot kept). Verify fire-and-forget is after $transaction closes, not inside.
