---
name: project_bonds_informational_layer
description: Bonds (GS/GB) informational-only layer — schema, ingest, /bonds surfaces, search tab. Shipped code-only, awaiting db push. Issued 2026-07-26.
metadata:
  type: project
---

Bonds informational layer implemented per
`.claude/agent-memory/ceo-product-strategist/cto_assignment_brief_bonds_info.md`
(brief issued 2026-07-26). Zero new data source — GS (Government Securities)
and GB (Sovereign Gold Bonds) series rows were already inside the daily
`sec_bhavdata_full` bhavcopy CSV apps/api already downloads for
`StockEodQuote`/`MarketMoverSnapshot`, just discarded by the `series !== 'EQ'`
filter.

**Schema**: additive `BondSeries` enum + `BondEodQuote` model in
`apps/api/prisma/schema.prisma`, placed right after `StockEodQuote`. Deliberately
a SEPARATE table (not mixed into `StockEodQuote`) so Movers/Search/enrichment-
warm-cron/future-Portfolios-valuation never see a bond symbol. `npx prisma
generate` run; **prisma db push NOT run — orchestrator's job**, per hard rule.

**Ingest**: `apps/api/lib/marketMoves/bhavcopy.ts` gained `shapeBonds`/
`fetchBhavcopyBonds`, wired into `fetchBhavcopySession`'s existing return
(added `bonds` field — zero second HTTP fetch, same `fetchBhavcopyRows` reused).
`apps/api/app/api/cron/market-moves-movers/route.ts`'s `runEodPass` now also
calls a new `upsertBonds()` — **true upsert (not createMany/skipDuplicates
like `upsertQuotes`)** because the brief requires `displayName` to be
recomputed every ingest run so a parser fix retroactively relabels history.
No new cron, no crontab change — rides the existing EOD pass
(`?source=eod` / outside-market-hours fallback).

**Naming parser**: new file `apps/api/lib/marketMoves/bondName.ts` —
`parseBondDisplayName(symbol, series)`. GS pattern (`/^(\d{3,4})GS(\d{4})$/`,
e.g. "1018GS2026" -> "10.18% GOI 2026") is brief-verified against real feed
data. GB pattern (`SGB` + 3-letter month + 2-digit year) was flagged
UNVERIFIED in the brief — falls back to the raw symbol and logs a warning via
`shapeBonds` when a GB symbol doesn't match, so the regex can be refined
post-launch without a schema change. **Not yet verified against a live GB
symbol list as of this writing — check ingest logs after first EOD run for
`did not match the SGB tranche pattern` warnings.**

**Web surfaces**: `apps/web/app/bonds/page.tsx` (listing, GS sorted by
maturity year parsed from symbol, GB alphabetical) + `apps/web/app/bonds/
[symbol]/page.tsx` (detail — reuses `PriceChart` component with
`defaultTimeframe="MAX"`, no `intradaySource` since bonds are EOD-only) +
`apps/web/app/bonds/layout.tsx` (mirrors `app/indices/layout.tsx`). Read
fetchers in `apps/web/lib/finance/bonds.ts`, direct-Prisma convention (same as
`lib/finance/instrument.ts`). **No nav entry** — reachable only via the search
modal's Bonds tab ("View all bonds →" link), following the same
search-only-discoverability precedent as `/indices` (see
[[project_web_live_ec2]] and the removed `/indices` directory page).

**Search**: `apps/web/app/api/instruments/search/route.ts`'s `SearchCategory`
widened to include `"bond"`; both `buildDefaults()` (empty-query, ranked by
volume) and the query path (fuzzy match on `symbol` OR `displayName`, so
"GOI"/"gold bond" queries work) now return real `BondEodQuote` results. Every
other category's construction path is untouched (verified via diff — only
additive bond wiring). `apps/web/components/finance/global-symbol-search.tsx`'s
Bonds tab now renders real results instead of the old "Bonds aren't tracked
yet" placeholder; Futures tab's empty-state copy is untouched.

**Not tradable**: no order ticket, no buy button, anywhere on any bond
surface — informational only per brief scope. `verify-papertrading-engine.ts`
re-run and confirmed 208/208 unaffected (bonds never touch the paper-trading
engine).

**Known gap / next step**: real ingest hasn't run yet in prod as of this build
(code-only, no db push). Once the orchestrator runs `prisma db push` and the
next EOD cron pass fires, re-check logs for any NEW GB-symbol fallback
warnings (a tranche-naming variant not yet seen).

**Parser fixed post-QA (2026-07-26), validated against real data**: QA found
89 real rows (45 GS + 44 GB, session 2026-07-24) already in the local dev DB
and flagged 2 bugs in `bondName.ts`, both fixed:
- GS: original regex only matched 3-4 digit coupon codes, missing 5 real
  2-digit codes (`68GS2060`, `92GS2030`, `71GS2034`, `73GS2053`, `74GS2062`).
  Fixed: `/^(\d{2,4})GS(\d{4})$/` with divisor branched by digit count (2
  digits → `/10`, 3-4 digits → `/100`). `697GR2034` (GR series, not GS) is
  correctly still unhandled/fallback — intentional, GR is a distinct NSE
  series this ticket never scoped in.
- GB: original regex only matched 3-letter month tokens, missing 10 real
  1-2 letter short forms from an older (~2021-22) SGB tranche-naming era
  (`MR`→Mar, `N`/`NV`→Nov, `OC`→Oct, `D`/`DC`/`DE`→Dec, `J`→Jan — all
  QA-confirmed against the real symbols; `JU`→Jun independently verified via
  NSE's own quote page for `SGBJU29III`, cross-checked against
  equitymaster.com, both titled "...JUNE 2029 SR-III" — NOT a general
  "JU always means June" rule, see `MONTH_ABBR_TO_INDEX`'s doc comment).
  Fixed: token regex widened to `[A-Z]{1,3}`, map extended with these
  verified short forms only (never guessed). Post-fix: GS fallback 6→1
  (697GR2034 only, expected), GB fallback 10→0. `verify-papertrading-engine.ts`
  reconfirmed 208/208 unaffected.
