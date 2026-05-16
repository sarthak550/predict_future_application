---
name: Sprint 28 Finance Tab Features
description: Architecture decisions and implementation details for S28 Finance tab features (follow system, pagination, direction filters, crowd-vs-experts)
type: project
---

Sprint 28 implemented four Finance tab features (2026-05-13):

**S28-T1: ExpertFollow system**
- Added `ExpertFollow` model to schema.prisma with @@unique([userId, expertId]) and @@index([userId, createdAt])
- Migration at apps/api/prisma/migrations/20260513100000_expert_follow/migration.sql (manual migration, shadow DB has enum issues)
- API routes: POST/DELETE/GET /api/finance/experts/[id]/follow, GET /api/finance/experts/followed
- Mobile: Follow/Following pill in ExpertOpinionRow (only for !isSourceAttribution), My Analysts horizontal chip row in finance-mode.tsx
- AsyncStorage key: `finance:followedAnalysts` for instant render on open

**S28-T2: Infinite scroll pagination**
- News route limit cap raised from Math.min(20) to Math.min(30)
- finance-mode.tsx: limit 10, onScroll triggers loadMore() when within 200px of bottom
- scrollEventThrottle={200} to avoid excessive callbacks
- hasMore/nextCursor/loadingMore state; footer ActivityIndicator + "No more opinions" text

**S28-T3: Direction filter chips + tappable sentiment cards**
- All client-side filter, no API changes
- Direction chips above Expert/Analysis toggle: All | Bullish | Bearish | Neutral
- Both AnalystSentimentCard and SentimentCard are Pressable
- AnalystSentimentCard tap maps dominantLean → selectedDirectionFilter and scrolls to expertSection
- Filter banner with "Clear filter ×" appears when selectedDirectionFilter != null
- Resets on pull-to-refresh

**S28-T4: Crowd vs. Experts card**
- GET /api/finance/crowd-vs-experts: uses retrospective votes + market yesCount/noCount as crowd signal
- Card hidden when resolvedCount < 10; provisional badge when resolvedCount < 20
- Seed: 10 resolved opinions (5 HIT, 5 MISS) in seedResolvedExpertOpinions()
- Type: ApiCrowdVsExperts in packages/types/src/index.ts (optional fields to handle resolvedCount=0 case)
- API client: getCrowdVsExperts(), followExpert(), unfollowExpert(), getFollowedExperts()

**Why:** Manual migration needed because prisma migrate dev shadow DB fails on pre-existing enums (MarketCategory, etc.) from earlier migrations that weren't created via prisma.
