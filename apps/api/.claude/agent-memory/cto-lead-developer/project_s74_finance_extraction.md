---
name: project_s74_finance_extraction
description: S74-T1/T2 finance expert-opinion extraction widening — QA-approved but sat uncommitted in the working tree; state as of 2026-07-13
metadata:
  type: project
---

S74-T1 and S74-T2 (widen `isApprovedFinanceSource` + throughput guardrails in
`apps/api/lib/ai/extractExpertOpinions.ts` and `apps/api/lib/news/rss-ingestion-service.ts`)
are marked `done` in `.claude/sprint-board.json` (QA-approved, including a round-2 fix for
the keyword pre-filter plural bug — see [[feedback_keyword_prefilter_word_boundaries]]) but
as of 2026-07-13 the code changes were still **uncommitted** in the working tree (`git
status` showed them modified, no matching commit in `git log`). S74-T3 (add 4 new Indian
finance RSS sources) is `in-progress`, S74-T4 (coverage logging) is `pending`.

**Why domain-only gating (not path-prefix widening) is correct:** `isApprovedFinanceSource`
now matches on hostname only (economictimes.indiatimes.com, cnbctv18.com, livemint.com,
moneycontrol.com) with no URL path check. This looks looser than it is — verified every RSS
feed source in `apps/api/lib/news/rssSources.ts` for these 4 domains (moneycontrol-markets,
economic-times-markets, mint-markets, cnbctv18-markets, et-expert-view, cnbctv18-views,
mint-columns) is already a dedicated markets/business/opinion feed. None of these domains
have a sports/lifestyle/tech feed configured anywhere in the ingestion source list, so a
FINANCE-categorized story from these domains can never be off-topic content — the RSS feed
selection IS the section scoping, making article-URL path-prefix matching redundant and
actively harmful (it's what caused CNBC TV18's 111 stories/week -> 0 opinions bug: general
market-news URLs from the market.xml feed don't start with /views/ or
/market/expert-views/). **Do not reintroduce path-prefix gating on
`ANALYST_OPINION_SOURCES`** without first re-auditing rssSources.ts for a domain that mixes
finance and non-finance feeds.

**Straggler sweep already exists:** `apps/api/app/api/cron/finance-opinions-catchup/route.ts`
(`CATCHUP_BATCH_SIZE` 120, 14-day lookback, queries `expertOpinions: { none: {} }`) is
functionally the finance-extraction straggler retry sweep — it was built as part of S74-T2
acceptance criteria, already wired into `apps/api/vercel.json` cron list (`30 8 * * *`,
daily). It differs from `resummarizeRecentStragglers()`'s pattern (inline fire-and-forget
call from within the same ingestion cron job) by running as its own separate daily cron
job instead — that's an intentional, already-shipped design, not a gap. Don't build a
second/duplicate inline sweep inside `extractFinanceOpinionsInBackground()`.

**2026-07-13 follow-up work done on top of the already-QA'd S74-T1/T2:** bumped
`MAX_FINANCE_EXTRACTIONS_PER_BATCH` 20 -> 50 in `rss-ingestion-service.ts` (more headroom
per ingestion cycle, still protected by the `hasPlausibleAnalystSignal` pre-filter). No
other extraction-pipeline files changed. `npx tsc --noEmit` clean. Not deployed (explicitly
out of scope for that task) — EC2 crontab (per [[project_ec2_prod_ops]] in the user's global
memory) mirrors vercel.json and will need reconciling with `finance-opinions-catchup` at
actual deploy/reship time, not verified from this sandbox.

See also [[feedback_keyword_prefilter_word_boundaries]] and
[[feedback_qa_pipeline_ownership]] for the QA history on this same ticket pair.
