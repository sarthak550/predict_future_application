---
name: project_instrument_page_v2
description: Instrument Page v2 (fundamentals + performance strip + on-demand news refresh) implemented 2026-07-25, T1-T5 shipped code-only, awaiting orchestrator db push + QA runtime verification (T6).
metadata:
  type: project
---

Implemented all 6 tickets of the CTO assignment brief at
`.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_instrument_page_v2.md`
on 2026-07-25. web-only per Decision 5 — zero apps/api/mobile changes.

## Single-schema architecture confirmed (overrides brief's "dual-sync" assumption)
`apps/web/prisma/schema.prisma` is DEAD — one commit ever (initial import),
referenced nowhere in tooling. `apps/web/Dockerfile` runs
`npx prisma generate --schema apps/api/prisma/schema.prisma` and apps/web
imports the workspace-hoisted `@prisma/client` — ONE physical schema file
governs both apps. Only edited `apps/api/prisma/schema.prisma`. Added
`InstrumentEnrichment` (singleton-per-symbol, JSON fundamentals/dividends
columns, two independent TTL timestamp columns: `fundamentalsFetchedAt` 7d,
`newsLastCheckedAt` 6h). Ran `npx prisma generate` — did NOT db push
(orchestrator's job, per hard rule). **Runtime will 500 on any
`prisma.instrumentEnrichment.*` call until the orchestrator runs a migration
against the real DB** — flag this before QA runtime-verifies T6.

## Cross-app duplication is the established codebase convention, use it
apps/web cannot import apps/api's lib code (separate deployed Next apps, no
path alias). `apps/api/lib/marketMoves/googleNews.ts`'s own doc comment
already documents duplicating `decodeGoogleNewsSource` out of
`rssProvider.ts` "to keep marketMoves/ self-contained, per the module
boundary already established" — so duplicating `fetchGoogleNewsForTicker`'s
RSS fetch/parse plumbing into `apps/web/lib/finance/googleNews.ts` (T4) is
in-pattern, not a shortcut. The actual RULES (relevance/material/roundup/
blocklist filters) are NOT duplicated — both apps import those from
`@predict-future/business-rules/marketPulse/newsQuality` byte-identically.
Same reasoning applied to `fetchYahooDailyChart`-style Yahoo fetchers: new
`apps/web/lib/finance/fundamentals.ts` mirrors
`apps/api/lib/finance/priceHistory.ts`'s never-throw/fixed-User-Agent
contract without importing it.

## Empirically verified Yahoo data contracts (2026-07-25, keyless, no crumb)
- `fundamentals-timeseries`: `timeseries.result[]`, one element per
  requested `type` key, `{meta:{type:[key]}, timestamp:[], [key]: [{asOfDate,
  reportedValue:{raw,fmt}}]}`. A symbol/key with zero coverage returns HTTP
  200 with that result element missing its data-array key ENTIRELY (not `[]`,
  not a zero) — this is the "series absent" signal to code against.
- Spot-checked 10 NSE tickers (large/mid/recent-IPO): 8/10 fully covered on
  all 6 keys (`annual{TotalRevenue,NetIncome,DilutedEPS}`,
  `quarterly{TotalRevenue,NetIncome,DilutedEPS}`). **2/10 (ZOMATO, TATAMOTORS)
  returned ZERO coverage on every key** — genuine per-ticker Yahoo gaps, not
  a bug: ZOMATO is indexed under ETERNAL.NS post-rename (verified ETERNAL.NS
  has full data); TATAMOTORS' 2025 demerger appears to have reset its Yahoo
  series. Real-world confirmation that T5's graceful-degrade requirement is
  load-bearing, not defensive-programming theater.
- Dividends via existing v8 chart endpoint + `&events=div`:
  `chart.result[0].events.dividends` map of `{amount, date(epoch s)}`.
  RELIANCE 1y = exactly 2 events (matches founder's reference), TCS = 4,
  IREDA = 1.
- INR unit decision: Yahoo's `reportedValue.raw` and dividend `amount` are
  PLAIN RUPEES (not lakh/crore-scaled) — verified via magnitude
  (RELIANCE FY26 net income raw 807,750,000,000 = ₹80,775 crore, matches
  public figures). Added `formatCompactINR` to `packages/utils/src/index.ts`
  (thresholds: >=1e12 "L Cr", >=1e7 "Cr", >=1e5 "L", else plain grouped
  rupees) — reusable anywhere else in the codebase that needs Indian
  compact-currency display.

## Files
- Schema: `apps/api/prisma/schema.prisma` (+`InstrumentEnrichment` model, appended at EOF).
- T2: `apps/web/lib/finance/fundamentals.ts` (fetchAnnualFundamentals/fetchQuarterlyFundamentals/fetchDividendHistory).
- T3: `packages/business-rules/src/marketPulse/returns.ts` (`computeReturnsStrip`, pure), exported from package index + `./marketPulse/returns` subpath. Unit tests: `apps/web/scripts/verify-returns-strip.ts` (`npx tsx scripts/verify-returns-strip.ts` from apps/web) — 23/23 passing, covers empty history, short-IPO history, flat series, exact-boundary session, holiday-gap fallback, FYTD before/after 1 Apr, FYTD with no prior-FY data, asOf predating all history.
- T4: `apps/web/lib/finance/googleNews.ts` (web-local `fetchGoogleNewsForTicker` duplicate), `apps/web/lib/finance/enrichment.ts` (`getOrFetchInstrumentEnrichment` — read-through + two independent fire-and-forget background refreshers with optimistic-timestamp race guards).
- T5: `apps/web/components/finance/performance-strip.tsx`, `apps/web/components/finance/fundamentals-panel.tsx`; wired into `apps/web/app/instruments/[symbol]/page.tsx` between the Analyst-opinions section and PulseTabs (non-negotiable per thesis alignment).
- `apps/web/lib/finance/instrument.ts` extended (not replaced) — `fetchInstrumentDetail` now also returns `performance: ReturnsStrip` and `enrichment: InstrumentEnrichmentData`, computed/fetched inline after `companyName` resolves, skipped entirely for index symbols (`isIndexOptionUnderlying`).

## Deviations from the brief / open items for QA (T6) and the orchestrator
- Did NOT touch `apps/web/prisma/schema.prisma` (brief said "dual-sync") — confirmed dead file, single schema is the real architecture.
- No live DB in this sandbox (no `.env`) — could not runtime-verify the on-demand news refresh end-to-end (T6's spot-check item) or the InstrumentEnrichment read/write path. All checks were static (tsc --noEmit clean on both apps, eslint clean on every touched file, 23/23 pure-function unit assertions). **Orchestrator must**: run the Prisma migration/db push for `InstrumentEnrichment` against the real DB, then QA must runtime-verify per T6 (long-tail small-cap symbol gets a fresh MarketMoveNews row after one visit; a second visit within 6h does not re-fetch; fundamentals panel renders/degrades correctly across a large-cap and a ZOMATO/TATAMOTORS-shaped zero-coverage symbol).
- Mobile fundamentals parity remains explicitly out of scope (Decision 5) — apps/api's `/api/finance/instruments/[symbol]/route.ts` (mobile backend) is untouched.
