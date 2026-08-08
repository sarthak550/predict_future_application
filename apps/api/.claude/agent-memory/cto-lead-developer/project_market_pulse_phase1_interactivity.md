---
name: project_market_pulse_phase1_interactivity
description: Market Pulse Top Movers interactivity sprint (price, why-is-it-moving headline, analyst-said badge) — built 2026-07-21, code-only, not yet deployed/db-pushed
metadata:
  type: project
---

Built 2026-07-21 per a CEO/coordinator brief that explicitly reserved prisma/schema.prisma edits for the CTO agent and fenced off the in-flight market-reset work (reset-markets.ts, publicSelect.ts, market/[id].tsx, app/api/markets/*, created-markets route, import-manifold-markets.ts, sync-manifold-resolutions route, .gitignore) as untouchable. Confirmed via `git status` before and after that none of those files were touched. tsc clean (0 errors) in apps/api, apps/web, apps/mobile via `npm run typecheck` (turbo) — packages/business-rules and packages/types have no standalone typecheck script; they're checked transitively through the three apps' tsc programs. apps/api and apps/mobile lint both fail on **pre-existing, unrelated** issues (api: `@typescript-eslint/no-explicit-any` rule not found in `app/api/finance/markets/route.ts`; mobile: `expo` eslint config missing) — reproduced identically with my diff fully `git stash`ed, so not caused by this sprint.

## Schema change (T1)
Added exactly one column: `MarketMoverSnapshot.lastPrice Float?` (nullable/additive). Verified the raw SQL diff via `prisma migrate diff --from-schema-datamodel <pre-edit-schema> --to-schema-datamodel prisma/schema.prisma --script`:
```sql
ALTER TABLE "MarketMoverSnapshot" ADD COLUMN "lastPrice" DOUBLE PRECISION;
```
Ran `npx prisma generate` locally (apps/api) after the edit — did NOT run `db push` (coordinator's job per the brief's guardrails). **Coordinator runbook: run `prisma db push` against prod before reshipping**, per [[project_ec2_prod_ops]] (CEO memory) — otherwise the cron will throw on `lastPrice` at write time (Prisma validates the column exists).

## Price threading (T2)
- `FetchedMarketMover` (apps/api/lib/marketMoves/types.ts) gained `lastPrice: number | null`.
- Live fetcher (nse.ts `fetchNseMovers`): NSE's `live-analysis-variations` row carries `ltp` (last traded price) — added to `NseVariationRow`, mapped straight through.
- EOD fetcher (bhavcopy.ts `fetchBhavcopyMovers`): already parsed `CLOSE_PRICE` as `row.closePrice` for the change-% math but didn't carry it out — now also sets `lastPrice: row.closePrice`.
- Cron (`app/api/cron/market-moves-movers/route.ts` `upsertMovers`) writes `lastPrice: m.lastPrice` into the session-replace rows — the delete+createMany transaction invariant is unchanged.
- Both read paths (`app/api/finance/market-moves/movers/route.ts`, `apps/web/lib/finance/marketPulse.ts` `fetchTopMovers`) return `lastPrice`. `packages/types` `ApiMarketMover.lastPrice: number | null`.
- Display: `₹1,830.50` via `toLocaleString("en-IN", {maximumFractionDigits:2})`, changeAbs shown as signed `+₹52.00`/`-₹12.30` beside the (still-dominant) `%`. Null price (legacy rows) → the price line is simply omitted, no placeholder.

## "Why is it moving" headline (T3) — read-time join, no schema
New pure module `packages/business-rules/src/marketPulse/topHeadline.ts` — `pickLatestHeadlinePerTicker(rows)`: drops `isBlockedPublisher` rows (reuses newsQuality.ts's existing blocklist, so junk publishers can never surface here either), then keeps the single latest-`publishedAt` row per `tickerSymbol`. **Deliberately does NOT apply `isMaterialHeadline`/roundup filtering** — the brief's T3 spec listed only "last 3 days, non-blocklisted, ticker match" as the criteria, and I followed that literally rather than importing the news feed's material-only gate; if headline quality/relevance turns out to be the weak point (chatty non-material headlines showing as "why is it moving"), the fix is adding `isMaterialHeadline` to `pickLatestHeadlinePerTicker`'s filter, not rebuilding the join.

Both read paths run ONE `MarketMoveNews.findMany({ tickerSymbol: { in: symbols }, publishedAt: { gte: now-3d } })` (not N+1) covering all movers in the response, then `pickLatestHeadlinePerTicker` picks the winner per ticker in memory. Note: no explicit NSE/BSE-twin handling was needed here beyond what the blocklist+latest-wins logic already does, since movers' `tickerSymbol` values are always bare NSE symbols (from nse.ts/bhavcopy.ts) and the query matches on that exact string — BSE-twin rows (`"BSE:xxxx"`) simply never match and are naturally excluded, no separate stripping logic required (unlike the analyst-ticker match in T4, which does need suffix-stripping because ExpertOpinion's `instrumentTicker` is Yahoo-style, not NSE-style).

## "Analyst said" badge (T4) — read-time join, no schema
New pure module `packages/business-rules/src/marketPulse/instrumentMatch.ts`:
- `nseSymbolMatchesInstrumentTicker(nseSymbol, instrumentTicker)` — strips a trailing `.XX` exchange suffix (`.NS`/`.BO`) and compares case-insensitively.
- `pickLatestAnalystCallPerTicker(rows)` — single pass over a bounded batch (last-14d, non-suppressed, `instrumentTicker != null` `ExpertOpinion` rows, no `IN` filter since the suffix-stripped match can't be expressed in SQL cheaply), builds a `Map<bareUppercaseSymbol, row>` keeping the latest `publishedAt` per bare symbol. Callers look up via `map.get(mover.tickerSymbol.toUpperCase())`. No new indexes added (brief said not to).

Both read paths run ONE `ExpertOpinion.findMany` for the bounded 14-day/non-null-ticker/non-suppressed set, independent of the movers count.

Display: web reuses `DirectionChip`/`VerdictBadge` from `components/finance/analyst-badges.tsx` (same components `big-call-card.tsx` uses) — analyst name links to `/analysts/[slug]` when `analystSlug` is non-null (Expert.slug is nullable — falls back to plain text, mirroring the exact ternary pattern already in `big-call-card.tsx`), verdict chip only renders when `resolutionStatus` is `RESOLVED_HIT`/`RESOLVED_MISS` ("graded"), not for `PENDING`/`NOT_GRADED`. Mobile renders a compact one-line `"{Name}: Bullish · pending"` string inside `MoverCard` with direction-colored text (success/danger/textMuted for BULLISH/BEARISH/NEUTRAL) — no new nav wiring, per the brief's explicit "link deferral OK" for mobile.

## Types/API surface (T5)
`packages/types` `ApiMarketMover` gained `lastPrice: number | null` (required, always present) and `topHeadline?`/`analystCall?` (optional, backward-compatible with any old cached client code). New exported types `ApiMarketMoverHeadline`, `ApiMarketMoverAnalystCall` — literal string unions for `direction`/`resolutionStatus`, following this file's existing convention of inlining enum-shaped literals rather than aliasing (see `ApiExpertOpinionItem` nearby for the same pattern) rather than importing `@prisma/client` enums into the mobile-facing types package.

`apps/mobile`'s `mobileApi.getMarketMovers()` (packages/api-client) needed NO code change — it's a typed passthrough (`request<ApiMarketMoversResponse>(...)`), so the new optional fields flow through automatically once `ApiMarketMover` was widened.

## Mobile card width bump
`market-moves-tab.tsx`'s `MoverCard` width was widened 128px → 168px to fit the new price/headline/analyst lines without cramming — not explicitly requested by the brief but a direct consequence of "same card style" plus three new lines of content; flagged here in case a future ticket wants it back to 128 for a denser strip.
