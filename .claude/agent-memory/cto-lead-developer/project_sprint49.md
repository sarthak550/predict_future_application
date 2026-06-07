---
name: project_sprint49
description: Sprint 49 Bundle A — ApiTopExpertEntry type, top-weekly endpoint, AnalystCredibilityBadge component
metadata:
  type: project
---

Sprint 49 issued 2026-06-07. Theme: "Analyst Scorecard brand visible everywhere."

## Bundle A (this session)

**T1 — GET /api/experts/top-weekly**
- File: `apps/api/app/api/experts/top-weekly/route.ts`
- Prisma groupBy on ExpertOpinion where resolutionStatus IN [RESOLVED_HIT, RESOLVED_MISS] AND resolvedAt >= NOW()-7d AND isSourceAttribution=false
- New index: `@@index([expertId, resolutionStatus, resolvedAt])` in schema + manual migration at `apps/api/prisma/migrations/20260607000001_s49_expert_opinion_weekly_index/migration.sql`
- Decision A (query-time): groupBy is one indexed query + one Expert lookup — no schema derived columns needed at current volume
- `ApiTopExpertEntry` type added to `packages/types/src/index.ts`
- Returns [] when < 3 experts qualify; max 10 entries; `revalidate = 3600`; no auth

**T2 — AnalystCredibilityBadge**
- File: `apps/mobile/src/components/analyst-credibility-badge.tsx`
- Composes `AnalystTierBadge` with name (bold), org (muted), tier chip, accuracy %
- Props: name, organization?, tier?, hitRate?, resolvedCount?, size ("sm"|"md"), onPress?
- hitRate suppressed if resolvedCount < 3
- ROOKIE tier suppressed on public surfaces (via surface="public" on AnalystTierBadge)
- Pressable wrapper only when onPress provided
- colors.success (#0F9D75) for accuracy stat

**Why Option A over Option B:**
The existing `/finance/experts/leaderboard` route already does a full expert scan with opinions loaded — Option B would add cron complexity for marginal perf gain. With the new composite index, the groupBy query is O(matching opinions in 7d window) which is bounded and fast. Option B is a future concern if top-weekly is called at high frequency from many surfaces.

**T3–T7:** Later bundles. Do not implement.
