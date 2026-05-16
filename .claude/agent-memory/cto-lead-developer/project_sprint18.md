---
name: Sprint 18 Finance Tab Restructure
description: Sprint 18 COMPLETE — Finance tab restructured as pure expert-opinion product: AnalystSentimentCard, cluster data panels, removed Other Finance Markets section, eventClusterId FK + scroll-to-section filter UX
type: project
---

Sprint 18 — Finance tab restructure: pure expert-opinion product. All 4 tickets passed QA on 2026-05-03.

**Why:** Finance tab was conflating Markets discovery (MarketChip scrolls inside clusters, "Other Finance Markets" section) with the expert opinion product. Goal was to make Finance tab purely about analyst sentiment and expert takes.

**How to apply:** When touching finance-mode.tsx or Finance-related API routes, maintain the pure expert-opinion product focus — no market browsing inside Finance tab.

## S18-T1: AnalystSentimentCard (DONE)
- New GET route: `apps/api/app/api/finance/expert-sentiment/route.ts`
  - No auth, `force-dynamic`
  - Queries PENDING ExpertOpinion rows from last 7 days, 3 parallel count calls by direction
  - Returns: bullishCount, bearishCount, neutralCount, totalCount, bullishPercent, bearishPercent, neutralPercent, dominantLean, samplePeriod:"7d"
  - dominantLean threshold: >55% share
- `ApiFinanceExpertSentiment` type added to `packages/types/src/index.ts`
- `getFinanceExpertSentiment()` added to `packages/api-client/src/index.ts`
- Replaces the old market-vote-driven SentimentCard in finance-mode.tsx

## S18-T2: Cluster data panels (DONE)
- Added `dataPoints Json?` field to `MarketEventCluster` in schema.prisma
- `ClusterDataPoint` type: `{ label: string; value: string; subtext?: string; date?: string }`
- `ApiFinanceEventCluster` updated with `dataPoints: ClusterDataPoint[]` and `expertTakeCount: number`
- All 3 clusters seeded with real data points in apps/api/prisma/seed.ts
- finance-mode.tsx: MarketChip horizontal scroll removed from cluster sections; replaced with compact data panel rows (label left, value+date right) + tappable expert-takes footer link
- API: getFinanceMarkets route returns dataPoints + expertTakeCount per cluster

## S18-T3: Drop Other Finance Markets section (DONE)
- Removed `unclusteredPage`, `nextCursor`, `loadingMore` state from finance-mode.tsx
- Removed `loadMore` function
- Removed Section 4 "Other Finance Markets" JSX entirely
- Added `{ key: "FINANCE", label: "Finance" }` to CATEGORIES array in markets.tsx so FINANCE markets remain discoverable in Markets tab public filter
- `MarketSummaryCard` import removed

## S18-T4: EventCluster FK + scroll-to-section filter (DONE)
- Added `eventClusterId String?` nullable FK to `ExpertOpinion` in schema.prisma
- Added `opinions ExpertOpinion[]` relation on `MarketEventCluster`
- Added `@@index([eventClusterId])` on ExpertOpinion
- Seed backfills: RBI/repo-rate/monetary-policy opinions → RBI cluster; Reliance/Q4/earnings → Earnings cluster
- API: expertTakeCount now computed via direct FK count: `prisma.expertOpinion.count({ where: { eventClusterId: cluster.id, suppressedAt: null } })`
- Mobile: scrollViewRef + expertSectionY ref, selectedClusterFilter state
- Cluster footer tap: setSelectedClusterFilter(cluster.id) + scrollTo expertSectionY
- Filter banner above opinions when filter active: "Showing: [cluster name] opinions — Clear filter ×"
- Pull-to-refresh clears filter
- `eventClusterId` added to `NewsFeedExpertOpinion` type in queries.ts and mapped in getPublishedNewsPage

## Key architectural note
The storyId field was temporarily added to MARKET_SELECT during S18-T2 for the story-market-cluster join approach, then removed in S18-T4 when superseded by the direct FK count approach. The `storyId` field is NOT normally part of MARKET_SELECT.
