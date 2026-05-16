---
name: Sprint 21 — Article body scraping pipeline
description: S21-T1 built article body fetcher (Readability+jsdom), integrated into Phase 3 ingestion, backfill + seed cleanup scripts
type: project
---

Sprint 21 single ticket S21-T1 implemented 2026-05-03.

**Components added:**
- `apps/api/lib/news/articleBody.ts` — `fetchArticleBody(sourceUrl)`: 10s timeout, 5MB cap, per-domain 1500ms throttle, Readability+jsdom extraction, rejects <200 chars, caps at 8000 chars, never throws
- `apps/api/prisma/schema.prisma` — Added `Story.bodyText String?`, `Story.bodyFetchedAt DateTime?`, `Story.bodyFetchFailed Boolean @default(false)`
- `apps/api/lib/news/rss-ingestion-service.ts` Phase 3 — before each `extractExpertOpinionsFromStory` call: fetch body if not present, persist result, pass bodyText (>=200 chars) or summary fallback
- `apps/api/scripts/backfill-article-bodies.ts` — processes up to 50 FINANCE stories per run, fetches bodies, extracts opinions
- `apps/api/scripts/delete-seed-finance-opinions.ts` — idempotent cleanup of rows where sourceUrl contains `predictfuture-seed`

**Dependencies installed:** `@mozilla/readability`, `jsdom`, `@types/jsdom`

**Smoke test results:**
- TypeScript clean: zero errors
- Seed cleanup: deleted 5 Stories, 5 Markets, 7 ExpertOpinions
- Backfill: 50/50 bodies fetched, 21 real opinions extracted from live articles

**Why:** Replace fake seeded expert opinions (from predictfuture-seed URLs) with real AI-extracted opinions from actual article body text, improving data quality for the Finance section.

**How to apply:** When touching Finance AI extraction or Story body fields, check this pipeline first.
