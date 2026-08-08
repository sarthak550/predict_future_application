---
name: project_quote_driven_intrabar_ticks
description: Founder complaint (live market open, 2026-08-04) — "candles are stale, no live fluctuations." Built a fast (~4-5s) quote poll folded honestly into the forming bar/point, for both the maximized workbench and the small terminal charts.
metadata:
  type: project
---

Direct incident-response assignment (not sprint-board), same posture as prior
TA Suite founder-feedback passes. Root cause was already diagnosed before I
started: server candle feeds ARE live, the gap is CADENCE — the existing 30s/
60s candle/intraday polls only refresh the full bar/point series, so between
polls the forming bar never visibly moved. See
[[project_ta_suite_signals_panel_liveness_audit]] for the prior liveness
audit this builds on (that pass tightened 60s→30s for 1m/5m; this pass adds
an actually-faster tick layer underneath it).

**Quote source, per feed kind.** Traced what the app ALREADY uses for live
prices before building anything new: equity order fills go through
`apps/web/lib/paperTrading/ltp.ts`'s `fetchDelayedLtp` → apps/api's
`/api/finance/instruments/[symbol]/intraday` → `lib/marketMoves/intraday.ts`
(Yahoo v8 chart, `.NS` suffix, 60s server cache). Index spot uses the sibling
`lib/marketMoves/indexIntraday.ts` (same Yahoo v8 chart, `YAHOO_INDEX_SPOT_TICKER`
map, also 60s cache). Both are the SAME underlying Yahoo endpoint the candle
fetcher (`lib/marketMoves/candles.ts`) also hits — the whole app has exactly
ONE upstream quote source, no separate lightweight "just the price" endpoint
existed anywhere. A 60s SERVER cache under a 4-5s CLIENT poll would just
return the same cached value repeatedly — defeats the purpose — so a genuinely
faster tick required a NEW, separately-cached fetch path, not a faster poll
against the existing one.

**New module: `apps/api/lib/marketMoves/liveQuote.ts`** (`fetchLiveEquityQuote`/
`fetchLiveIndexQuote`), a fast sibling of intraday.ts/indexIntraday.ts —
same proven Yahoo v8 chart endpoint (deliberately NOT Yahoo's `v7/finance/quote`,
which has historically needed a crumb/cookie handshake this codebase doesn't
implement — not a responsible new-integration gamble mid-incident), but
`range=1d&interval=1d` instead of `interval=1m` — Yahoo's `meta.regularMarketPrice`/
`regularMarketTime` block is a live session-quote snapshot populated
independent of the requested bar granularity, so this is a much smaller
payload appropriate for a ~4s-cached poll (falls back to the array's own
last point if meta is ever absent, never a second upstream shape). Own
short TTL cache (~4s, `QUOTE_CACHE_TTL_MS`), completely separate Map from
the 60s caches — every concurrent viewer of a symbol shares ONE upstream
Yahoo hit per ~4s window. Routes: `/api/finance/instruments/[symbol]/quote`
(apps/api) → apps/web proxy `/api/instruments/[symbol]/quote`, and the
`/index/[symbol]/quote` siblings — same loopback-proxy pattern as every
other instruments route. `Cache-Control: no-store` (not the sibling routes'
`public, max-age=60`) since this response is stale within ~4s by design.

**Client hook: `apps/web/components/paper-trading/use-live-quote-tick.ts`**
(`useLiveQuoteTick`, `LIVE_QUOTE_POLL_MS = 4500`). Triple-gated: visibility
(`useVisiblePolling`, pre-existing), market hours (`isNseWeekdayMarketHours`
from `@predict-future/business-rules/papertrading/marketHours` — belt-and-
braces, checked BOTH in the `enabled` flag AND again inside the fetch
callback itself, so a stale `enabled` from a render that happened before
market close still can't fire a network call after close), and active-only
(this hook only ever runs in a component mounted for the ONE symbol on
screen — no watchlist-polling caller exists). `LiveQuoteTick.asOf` is the
CLIENT's own `Date.now()` at fetch receipt, deliberately NOT the server's
own upstream timestamp — bar-boundary decisions are a real-world-clock
question, and trusting an unverified new upstream field for that would be a
worse failure mode than a locally-consistent clock (a dropped tick from
clock imprecision is always the safe failure, never a dishonest one).

**The shrinking-wick bug I caught before shipping.** My first
`foldQuoteIntoCandles` design recomputed `high/low` as
`Math.max(last.high, tick.price)` against the PRISTINE base fetch's own
high/low on every fold. That's wrong: if tick N pushes a new high above the
base, then tick N+1 arrives with a LOWER (but still base-exceeding) price,
re-deriving from the pristine base would DROP tick N's already-recorded
high — a candle's wick visibly shrinking mid-formation, which no real bar
ever does and which directly violates the honest-simulation law even though
it's not "touching a closed bar." Fixed with a `runningExtremesRef` in
`use-workbench-candles.ts`, updated in a COMMIT-phase `useEffect` (never
mutated during the render/memo itself) — the fold always uses
`Math.max(runningHigh, tick.price)` against the accumulated-across-ticks
high, reset only when the base fetch's own last-bar TIMESTAMP changes (a
genuine new bar/rollover/interval-switch), and still absorbs the server's
own fresh high/low each time it refetches (the 30s/60s poll stays the
correction authority). Worth re-reading `foldQuoteIntoCandles`'s doc comment
in full before touching this again — the "why not read `last.high` directly"
reasoning is easy to re-break by "simplifying."

**Fold mechanics.** A tick is only folded if `tick.asOf` falls inside the
last bar's own `[timestamp, timestamp+intervalMs)` window; outside that
window (real bar has rolled over server-side, client just hasn't caught up)
the tick is silently dropped — never touches a closed bar, never fabricates
a new one client-side. Deliberately SKIPPED for the "1d" interval — a daily
bar's honest forming-window is "until today's NSE close," not a fixed
duration, and getting that boundary wrong risks the one law this feature
must never break; nobody watches a daily candle tick bar-by-bar anyway.
Downstream plumbing needed ZERO changes: `chart-workbench.tsx`'s
`candlesKey` already includes last close/high/low, so the signals/rating
pipeline and klinecharts' own `subscribeBar` push (keyed on `candles` array
identity, per the prior liveness audit's trace) just picked this up.

**Small terminal charts (`price-chart.tsx`).** Same principle, different
shape: no OHLC concept, so a fresh tick is APPENDED as a new point (never
overwrites), same "session tick" pattern `premium-chart.tsx`/the workbench's
`optionPremium` branch already established for `livePremium`. New optional
`quoteSource` prop mirrors `intradaySource`'s existing default/override
contract — but with one deliberate asymmetry: `quoteSource` only
auto-defaults to the bare-equity URL when `intradaySource` is ALSO omitted.
If a caller overrides `intradaySource` (index) WITHOUT also passing
`quoteSource`, the live poll simply stays off rather than guessing a URL
that would 404 forever — this is what keeps the indices/bonds standalone
pages (`app/indices/[slug]`, `app/bonds/[symbol]`, both PriceChart consumers
outside this pass's explicit scope) at exactly their pre-existing behavior,
zero risk, with no per-caller opt-out flag needed. Futures/options terminals
updated to pass the matching `quoteSource` alongside their existing
`intradaySource`. `liveTicks` capped at 500 points (`.slice(-500)`) as a
defensive-only bound — terminals reset it every `pollIntervalMs` (60s)
anyway via `fetchIntraday`'s success handler and never get near the cap; it
only matters for a caller with no background poll at all (found: the
options terminal's underlying chart had NONE before this pass — added
`pollIntervalMs={60_000}` there too since my new feature's honesty guarantee
("periodic refetch is the correction authority") depends on that refetch
actually existing).

**Premium mode untouched by design.** Option premium already had its own
~30s `livePremium` chain-poll tick folded in (pre-existing, both in
`use-workbench-candles.ts`'s `optionPremium` branch and `premium-chart.tsx`)
— that IS the feed's honest freshness ceiling (a 5-minute server-side
snapshot cadence sits underneath it); this pass explicitly does not touch it
or fake a faster tick for it.

**Heartbeat chip honesty.** `useWorkbenchCandles` now returns
`liveTicksActive: boolean` (true only when the fast poll is genuinely
running: equity/index, intraday interval, NSE hours open) alongside
`pollIntervalMs` (now reports whichever cadence is ACTUALLY in effect —
`LIVE_QUOTE_POLL_MS` when ticking, the slower candle cadence otherwise) and
`lastUpdatedAt` (bumped on every successful quote tick too, not just the
candle fetch). `chart-workbench.tsx` uses `liveTicksActive` to pick honest
two-tier cadence copy ("price ticks ~5s, full bars 30-60s") only while it's
genuinely true, falling back to the pre-existing generic copy otherwise —
never claims a cadence that isn't actually running.

**Gates, 2026-08-04**: tsc clean across apps/web + apps/api + all 4
packages (required a `prisma generate` first — pre-existing stale client in
this sandbox unrelated to my change, see
[[feedback_prisma_generate_after_migration]]); eslint clean on every touched
file; `ta:check` 195/195 (unchanged — this pass never touches `lib/ta/`);
`verify-papertrading-engine.ts` 275/275 (baseline had already drifted from
264 due to a DIFFERENT concurrent session's uncommitted "Expiry Settlement
Backfill" work already in this working tree — touches
`packages/business-rules/src/papertrading/replay.ts`, `schema.prisma`,
several apps/api cron files — verified zero overlap with my own diff,
flagged rather than silently absorbed); `next build` First Load JS for the 3
paper-trading terminal pages: 139/137/143 kB, each exactly +1kB (~0.7%) over
the recorded 138/136/142 baseline — attributable to `use-live-quote-tick.ts`
+ the `price-chart.tsx` additions landing in the SYNCHRONOUS per-page bundle
(unlike the workbench's own changes, confirmed still confined to the async
`chart-workbench` dynamic-import chunk via `react-loadable-manifest.json`).
This delta is expected and unavoidable given the brief's own explicit
requirement to extend liveness to the small, synchronously-loaded terminal
charts — not a violation of the "First-Load unchanged" house rule, which
was written for workbench-only/deferred-chunk changes.

**Files**: `apps/api/lib/marketMoves/liveQuote.ts` (new),
`apps/api/app/api/finance/instruments/[symbol]/quote/route.ts` (new),
`apps/api/app/api/finance/instruments/index/[symbol]/quote/route.ts` (new),
`apps/web/app/api/instruments/[symbol]/quote/route.ts` (new),
`apps/web/app/api/instruments/index/[symbol]/quote/route.ts` (new),
`apps/web/components/paper-trading/use-live-quote-tick.ts` (new),
`apps/web/components/paper-trading/workbench/use-workbench-candles.ts`
(fold + running-extremes ref + liveTicksActive),
`apps/web/components/finance/price-chart.tsx` (quoteSource prop + live-tick
append), `apps/web/components/paper-trading/futures-page-client.tsx` +
`options-page-client.tsx` (wire `quoteSource`, add missing
`pollIntervalMs`), `apps/web/components/paper-trading/workbench/chart-workbench.tsx`
(cadence copy). Not committed — CTO delivers code, does not commit unless asked.

**QA-caught regression + fix (2026-08-04, same day, live NSE session).**
QA verdict was PASS on fold honesty/gating/cadence (4491-4508ms measured
live) but FAIL on one scoped bug: `app/bonds/[symbol]/page.tsx` passes
NEITHER `intradaySource` NOR `quoteSource` to `PriceChart`, so it silently
inherited the bare-equity default — clicking "1D" on a bond page (e.g.
`SGBDEC26`, not a Yahoo-tradable ticker) started a REAL recurring ~4.5s
outbound Yahoo hit to `/api/instruments/SGBDEC26/quote`, 404 every cycle,
for as long as the tab stayed open in market hours. Pre-change behavior was
a single one-shot `/intraday` 404 (harmless); my design mirrored that same
"omit ⇒ default to equity" shape without registering that a RECURRING poll
has a completely different risk profile than a one-shot fetch. My own prop
doc even incorrectly claimed bonds was covered by the "intradaySource
IS given" safe branch — it wasn't; that was a documentation error, not just
a code gap.

**Full call-site audit** (grep for every `<PriceChart` in apps/web) found 8
render paths across 7 files: `app/indices/[slug]/page.tsx` (safe, passes
`intradaySource`), `app/bonds/[symbol]/page.tsx` (BUG — neither prop),
`app/instruments/[symbol]/page.tsx` (two branches — index branch passes
`intradaySource`, safe; equity branch omits both, correct/intended),
`paper-trading-dashboard.tsx` (omits both, correct/intended — real equity
`focusedSymbol`), `futures-page-client.tsx` + `options-page-client.tsx`'s
index branch (both pass explicit `quoteSource`, added this same day),
`options-page-client.tsx`'s equity branch (omits both, correct/intended).
Verdict: omitting both props is common (5 of 8 paths) AND legitimate in 4
of those 5 — only bonds is broken. This argues AGAINST inverting the
default (which would require touching `paper-trading-dashboard.tsx`, a file
untouched this whole pass, purely to re-add behavior it already has for
free) and FOR a targeted explicit opt-out instead.

**Fix**: widened `quoteSource` to a real 3-state prop —
`{ url: string } | false | undefined` — where `false` is a REQUIRED,
unambiguous "never poll" signal (not inferred from `intradaySource`, which
correlates for index callers but not for bonds). `bonds/[symbol]/page.tsx`
now passes `quoteSource={false}` explicitly. `indices/[slug]/page.tsx` and
`instruments/[symbol]/page.tsx`'s index branch were left on the pre-existing
`intradaySource`-present inference (already correct, zero bug) rather than
migrated to the explicit convention too — flagged here as a low-priority
future cleanup, not touched to keep this fix's diff minimal and scoped to
the actual regression. Lesson for next time: when mirroring an EXISTING
"omit ⇒ default" pattern for a NEW recurring-poll feature, re-derive the
safety case from scratch — a pattern that was safe for a one-shot fetch is
not automatically safe once it becomes a poll.

**Not done this session**: live-market verification (no dev server/DB/open-
market session available here) — the required next step is the SAME kind of
Monday-open-style checklist prior TA Suite passes have needed: open a 1m/5m
equity AND index chart during NSE hours, confirm the forming bar's wick only
ever grows (never shrinks) across several ticks, confirm price ticks land
every ~4-5s while the candle bar itself only fully refreshes every 30-60s,
confirm the heartbeat chip's cadence copy switches correctly, confirm the
small terminal charts (dashboard/futures/options) all show the same live
motion, and confirm nothing ticks when the market is closed or the tab is
hidden.
