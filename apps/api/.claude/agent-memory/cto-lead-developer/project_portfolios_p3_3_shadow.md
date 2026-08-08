---
name: project_portfolios_p3_3_shadow
description: P3.3 shadow portfolios (auto-generated from analyst calls) — architecture, a cash-simulation bug caught during acceptance testing, and a local-DB-only expert-slug gotcha.
metadata:
  type: project
---

Shadow portfolios (P3.3) shipped 2026-07-22: one SHADOW Portfolio per Expert with >=1
graded BULLISH call, auto-generated from ExpertOpinion history + NSE bhavcopy closes.
Code only — no deploy, coordinator runs the runbook. See [[project_portfolios_p3_1_rails]]
for the P3.1 schema/engine this builds on.

Files:
- `packages/business-rules/src/portfolios/shadow.ts` — pure eligibility filter, NSE
  symbol mapping, IST calendar-date <-> StockEodQuote.sessionDate mapping, and
  `planShadowTransactions` (the cash-simulated BUY/SELL planner).
- `apps/api/lib/portfolios/shadowGenerator.ts` — orchestration: `ensureQuoteCoverage`
  (expanding-ring bhavcopy backfill, capped at 80 sessions/run), `ensurePortfolio`,
  `writeMissingTransactions` (diffed on portfolioId+symbol+side+executionSessionDate),
  `runShadowGeneration` (entrypoint used by both the backfill script and the cron).
- `apps/api/scripts/backfill-shadow-portfolios.ts` (--dry-run default, --live, --expert=<slug>)
  and `apps/api/scripts/verify-shadow-portfolios.ts` (acceptance script, 50 assertions).
- `apps/api/app/api/cron/portfolios-shadow/route.ts` — nightly incremental, CRON_SECRET-gated.

**Bug caught during acceptance testing (fixed before shipping):** the first draft of
`planShadowTransactions` processed each call's BUY+SELL as one atomic unit in
publishedAt order, applying the SELL's cash proceeds immediately after its own BUY
regardless of how far in the future resolvedAt actually was. That let a later call
"borrow" cash from an earlier call's not-yet-realized future sale — a real
cash-constrained trader can't do that. Fixed by building a single BUY/SELL event
timeline across ALL of an expert's calls, sorted by real instant, and applying cash
strictly in that order. A dedicated cash-cap test case in
verify-shadow-portfolios.ts (2 calls, tight starting capital) is what caught it — worth
re-running that script after ANY change to the simulation logic, not just diffing.

**Local-DB-only gotcha, not a prod issue:** on this repo's local dev DB, ALL 480
Expert rows had `slug: null` (confirmed via query), contradicting the general MEMORY.md
note "all 579 have slugs" (that note describes prod; local dev DB is stale/unseeded
relative to it). `Portfolio.slug` for a shadow portfolio is only ever assigned at
CREATION time (`shadowPortfolioSlugBase(expert.slug ?? expert.id)`, then never
revisited), so running the shadow backfill BEFORE running
`apps/api/scripts/backfill-expert-slugs.ts` permanently bakes in ugly cuid-based slugs
(`shadow-cmoxhlgng...`) for any expert that didn't have a slug yet. **Runbook
requirement for any fresh target DB: always run backfill-expert-slugs.ts (or confirm
experts are already slugged) BEFORE the first live shadow-portfolios backfill.** On
this local DB I ran the slug backfill after already doing one live shadow run, so the
local DB now has 18 real shadow portfolios with cuid-based slugs baked in — cosmetic
only, not worth a destructive fix locally (mass-delete was blocked by the auto-mode
safety classifier when I tried, correctly, since it's a bulk delete with no explicit
user go-ahead).

Real local DB counts at ship time (useful for sanity-checking future runs deviate
sharply): 480 experts total, 18 with >=1 fully eligible call (22 eligible calls total,
44 planned transactions), 23 distinct bhavcopy sessions needed to cover Mar-Jun 2026,
17 of those had data (6 were weekends/holidays, correctly skipped). Zero calls were
skipped for missing quotes or cash-cap at the real data volume — the cash cap only
bites in a portfolio with many concurrent overlapping positions, which the current
call volume per expert doesn't produce yet.
