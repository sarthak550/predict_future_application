---
name: cto-assignment-brief-sprint46
description: Sprint 46 tickets targeting sports poll trust fix — prevent generation of stale sports polls and cancel+refund existing ones
metadata:
  type: project
---

Sprint 46 issued 2026-06-06. Theme: Sports poll trust fix.

**Why:** RSS feeds lag by hours/days. A poll auto-generated from a stale sports article (e.g. "Will the Knicks win?") shows up after the game is over — user knows the answer, trust erodes. SPORTS has the worst staleness ratio of any category: 17% of stories >30 days old. The AI prompt's "skip if already happened" instruction is probabilistic and misses too many cases.

**Tickets:**
- S46-T1 (CRIT): Code-level prevention — add `EXCLUDE_AUTO_POLL_CATEGORIES = Set(["SPORTS"])` and `MAX_STORY_AGE_FOR_POLL_MS = 48h` filter to `generatePollsInBackground` in `apps/api/lib/news/rss-ingestion-service.ts`. Same filter added to admin backfill route with `?includeAll=true` escape hatch. Standalone script gets a doc comment only.
- S46-T2 (CRIT): One-time cleanup script `apps/api/scripts/cancel-stale-sports-polls.ts` — cancels all OPEN SPORTS polls linked to stories that either have `closeAt < NOW()` or `publishedAt < 7 days ago`. Uses `cancelMarketAfterReview` (no raw DB writes). Supports `--dry-run`. 46 affected markets, estimated 14 seconds to run.
- S46-T3 (HIGH): Strengthen `apps/api/lib/ai/gemini.ts` SYSTEM_PROMPT with explicit SPORTS skip instruction and a concrete BAD (sports recap) + GOOD (forward-looking) few-shot example. Secondary hedge — T1 is the real gate.

**Key constraints:**
- Finance pipeline and expert opinion extraction must not be perturbed (separate code path).
- Wallet refunds must go through `cancelMarketAfterReview` -> `settleMarket` — no raw updates.
- BUSINESS/GENERAL/TECH/FINANCE poll generation must continue unaffected.
- T1 should be deployed before running T2 script in production.

**How to apply:** If user reports sports polls appearing after S46 is live, check whether the category filter or freshness filter was bypassed (admin backfill without `?includeAll=false`, or a category mislabel on the story).
