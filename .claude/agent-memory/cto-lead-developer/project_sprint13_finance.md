---
name: Sprint 13 Finance Section — Complete
description: Sprint 13 India-first Finance section: schema (T1), AI extraction (T2), source tagging (T3), mobile card (T4). All 4 tickets complete.
type: project
---

Sprint 13 implemented the India-first Finance section. All 4 tickets delivered (2026-05-02).

**Why:** Vertical positioning: "Indian markets through a global lens." Expert opinions create a smart-feed differentiator. S14 will add poll creation from opinions.

**T1 — Schema + Seed:**
- Expert/ExpertOpinion models, OpinionDirection/OpinionResolutionStatus enums, FINANCE in MarketCategory
- Migration: `apps/api/prisma/migrations/20260502131955_add_finance_expert_opinions/migration.sql`
- 5 org-level Expert rows seeded (verified=true, name="")
- Config fix: `packages/config/src/index.ts` marketCategoryLabels required FINANCE label

**T2 — AI Extraction Pipeline:**
- `apps/api/lib/ai/extractExpertOpinions.ts` — Gemini-only (temperature 0.2), extractExpertOpinionsFromStory() + persistExpertOpinions() + isApprovedFinanceSource()
- Phase 3 added to `apps/api/lib/news/rss-ingestion-service.ts` after Phase 2 (AI polls)
- Only fires if GEMINI_API_KEY set AND story from approved finance source domain

**T3 — Source Expansion + FINANCE Tagging:**
- `apps/api/lib/news/financeTagging.ts` — evaluateFinanceTag() with dual-gate: source domain + 50+ India market keywords (case-insensitive RegExp)
- 4 new active RSS sources in `apps/api/lib/news/rssSources.ts`: Moneycontrol, Economic Times, Mint, CNBC TV18. Bloomberg India commented out (sitemap XML format incompatible with rss-parser)
- CRITICAL: InternalNewsCategory does NOT include FINANCE. FINANCE override applied in storiesToIngest mapping in rss-ingestion-service.ts, not at RSS parsing level.

**T4 — Mobile Expert Take Card:**
- `packages/types/src/index.ts`: ApiExpertOpinionItem type + expertOpinions?: ApiExpertOpinionItem[] on ApiNewsFeedItem
- `apps/api/lib/news/queries.ts`: newsFeedInclude now includes expertOpinions (take:3, orderBy publishedAt desc)
- `apps/api/app/api/news/route.ts`: passes expertOpinions through to response
- `apps/mobile/src/components/news-feed-card.tsx`: ExpertOpinionRow + ExpertTakeSection components, FINANCE-only guard, +N more takes expand, disclaimer footer
