---
name: project_ta_suite_signals_panel_liveness_audit
description: Founder-feedback pass (2026-08-06) — all-indicators Signals table with educational hover reasons (Part 1) + candle liveness audit/heartbeat (Part 2). Builds on [[project_ta_suite_stats_pills_founder_feedback]].
metadata:
  type: project
---

Built 2026-08-06 as a direct assignment (not sprint-board pipeline), same
posture as every prior TA Suite pass. Two independent asks: (1) a full
per-indicator Signals table under the existing Technicals gauge, with
three-part educational hover/tap reasons on every signal chip — including
the pre-existing active-indicator strip's chips; (2) an end-to-end audit of
why candles might not "move live" during market hours, since the market has
been closed since the workbench shipped and the live path had literally
never run.

**Part 1 — the rule-table refactor is the load-bearing piece.**
`lib/ta/technicals.ts`'s `computeTechnicalRating` (existing) and the new
`computeTechnicalDetail` now BOTH read the exact same `MA_RULES`/
`OSCILLATOR_RULES` array's `evaluate()` calls — one rule table, two
consumers. This is a REAL regression guard, not just doc claims: `ta:check`
gained `checkTechnicalDetailConsistency`, which runs both functions on the
SAME candle series and asserts the detail table's row tallies exactly equal
the rating's own group counts (86 total assertions now, up from 76).
`minBars` per oscillator rule was hand-derived by reading `math.ts`'s own
`i >= …` warm-up gates line-by-line (RSI seeds at `i===period`→15 bars;
Stochastic %K(14,3,3) chains three warm-ups→18; ADX's `adx` itself seeds at
`period*2-2`→27; MACD's `dea` needs `slowPeriod-1+signalPeriod`→34; etc. —
each one commented in-code with its own trace) — NOT guessed, since a wrong
`minBars` would either fabricate-looking-honest text or hide a real reading
behind an unnecessary "needs N bars." This number is purely a DISPLAY
string though — the actual skip/evaluate decision always comes from whether
`evaluate()` itself returned `undefined`, so an imprecise `minBars` could
never cause a false signal, only a slightly-off "needs N bars" caption.

**Reason-sharing design — three shared builder functions, not shared vote
logic.** `priceVsLineReason`/`obOsReason`/`macdReason` (exported from
`technicals.ts`) take an ALREADY-COMPUTED zone/direction and return only the
`{rule, reading, meaning}` text — deliberately NOT recomputing the vote
themselves. Reason: `indicator-signals.ts`'s existing `priceVsLine`/
`obOsState` helpers have their OWN boundary semantics (e.g. `obOsState` uses
`<=`/`>=` inclusive at the exact threshold, while `technicals.ts`'s own
RSI/CCI/WR rating rules use strict `<`/`>`) — a REAL, pre-existing
discrepancy between the two modules that this pass found but deliberately
did NOT unify (silently changing either module's vote boundary would be an
unreviewed behavior change with no bug report behind it). Sharing only the
wording, with each caller passing its own already-determined zone, keeps
both modules' tested boundary logic 100% untouched while making the TEXT
byte-identical wherever the convention genuinely overlaps (RSI, MA/EMA/SMA/
BBI/WMA/VWMA/HMA's price-vs-line read, WR, CCI, StochRSI-K, MACD). KDJ/MFI
route through the same `obOsReason` builder too even though `technicals.ts`
has no KDJ/MFI rating rule — sharing the BUILDER (not a specific indicator's
rule) avoids a third independently-worded copy of the same oversold/
overbought convention shape. Seven indicators get fully bespoke, LOCAL
reason text in `indicator-signals.ts` because they have no equivalent in
`technicals.ts`'s 11-oscillator TradingView rating set: SAR, DMI (ADX's
strong/weak-trend vocabulary is genuinely different from the rating's own
buy/sell/neutral ADX rule — deliberately NOT shared), BOLL/KELTNER/DONCHIAN
(bands), VWAP (mechanically a price-vs-line read but given session-anchored
wording on purpose — VWAP means something distinct enough to traders to say
so rather than reusing generic "moving average" text), AROON, ICHIMOKU (the
cloud), SUPERTREND.

**Hover/tap mechanism — one shared component, not two.**
`signal-reason-trigger.tsx`'s `SignalReasonTrigger` wraps a `<button>` in a
`<span>`: desktop hover shows/hides via mouseenter/mouseleave, touch (which
has no hover) ALSO gets a tap-to-toggle on the same button, dismissed via
the identical outside-pointerdown/Escape idiom `chart-order-intent-popover
.tsx` already established (same styling precedent reused: white card,
rounded-2xl border, shadow-lg). Rendered as a SIBLING of any other
interactive controls in the parent row (never nested inside another
button) — deliberately following this program's own documented nested-
button-bubbling lesson from the 2026-08-03 founder-feedback pass, even
though this specific case has no interactive content inside the popover
card itself (just text) so the bug class doesn't literally apply — kept
sibling-structured anyway as the established house convention for any
button-triggered popover in this workbench.

**Signals table structure**: `signals-table.tsx`'s `SignalsTable` renders
two collapsible `Section`s (Moving Averages / Oscillators, both DEFAULT
COLLAPSED — a 23-row combined table would otherwise dominate the narrow
right panel on first Strategy-tab open), each showing its own group tally
in the header sourced directly from `rating.ma`/`rating.oscillators` (not
recomputed from the row array — by construction always consistent, per the
`ta:check` guard above). A skipped row renders "needs N bars" in muted
italic text with NO badge at all (the honesty law — never a fabricated
signal). Rendered directly under `<TechnicalsGauge>` in `chart-workbench
.tsx`'s Strategy tab; the gauge's own honesty line was updated to the
founder-provided exact copy ("Rule-based readings of standard indicators on
the loaded delayed bars — descriptions explain the convention, not a
recommendation.") since it now covers both the dial and the table.

**Part 2 — the liveness trace verdict: nothing was actually broken.**
Traced the full path end-to-end against real source, not assumed: client
poll (`use-workbench-candles.ts`'s `useVisiblePolling`) → fresh `candles`
array on every successful fetch (`.filter().map()` always returns a NEW
array reference, even if content is byte-identical to the last poll) →
`kline-chart.tsx`'s data effect (keyed on `candles` object identity
DELIBERATELY, per that effect's own existing doc comment — confirmed this
is correct, not a stale-dep bug) → `subscribeBarCallbackRef.current?.(last)`
→ klinecharts v10's OWN `StoreImp.prototype._addData` (verified by reading
`node_modules/klinecharts/dist/index.esm.js` directly, not the .d.ts):
`setPeriod`/`setSymbol` both route through `resetData()`, which
UNSUBSCRIBES then immediately re-subscribes the live-bar channel on every
call via the `type==='init'` branch of `_processDataLoad`'s `getBars`
callback — so every full reload (interval change, window shift, initial
mount) correctly re-arms `subscribeBar`, and the single-bar `_addData`
non-array branch correctly append-or-replaces by exact timestamp match and
ALWAYS triggers a repaint (`_adjustVisibleRange` + `_calcIndicator`/
`chart.layout`). Server-side: `apps/api/lib/marketMoves/candles.ts`'s 60s/
300s TTL cache correctly revalidates via a real `Date.now() - cached.at <
ttl` check (no stale-forever bug); `apps/web`'s two proxy routes
(`app/api/instruments/[symbol]/candles`, `.../index/[symbol]/candles`) are
both `export const dynamic = "force-dynamic"` with `cache: "no-store"` on
the UPSTREAM fetch too — ruled out the classic Next.js App Router gotcha
(server-side `fetch()` defaulting to `force-cache`) that was the leading
hypothesis before reading the actual route files. `useVisiblePolling`
itself already had a correct pause-on-hidden/catch-up-tick-on-return
mechanism and IS correctly wired into both `useWorkbenchCandles` branches
(equity/index AND premium) — confirmed reachable, no strand risk. **Net
verdict**: the founder's report is best explained by the documented caveat
that the market has been closed since ship, not a code defect — every link
in the chain was independently verified correct by reading the actual
klinecharts internals and the actual cache/proxy code, not just re-stating
existing doc comments as ground truth.

**The one real, actionable change**: cadence was a flat 60s poll for EVERY
interval (1m through 1d) on the equity/index branch. `pollMsForInterval`
(new, exported from `use-workbench-candles.ts`) tightens 1m/5m to 30s,
leaving 15m/30m/60m/1d at 60s (unchanged) — halves the worst-case gap
between a real Yahoo print and it reaching the browser specifically on the
two intervals traders watch bar-by-bar. Premium mode's own poll stays a
fixed 60s (already fast relative to its 5-minute server-side snapshot
cadence, per that hook's own pre-existing doc — not touched). Effective
freshness bound, now surfaced in the heartbeat chip's own tooltip rather
than only living in a code comment: Yahoo's own delayed-data latency
(unknown/uncontrolled) + up to 60s server-side TTL cache + the client poll
interval (30s or 60s depending on chart interval).

**Heartbeat chip** (`heartbeat-chip.tsx`): "Updated HH:MM:SS" (IST,
`Intl.DateTimeFormat` with `Asia/Kolkata` — same timezone convention
`chart-workbench.tsx`'s own `formatIstDateShort` already uses elsewhere in
this file), turning muted-amber "Stale — retrying" once
`now - lastUpdatedAt > pollIntervalMs * 3`. Render-loop-law-compliant: the
displayed clock is a `now` STATE ticked by a `setInterval` inside a mount
`useEffect` (same "periodic side effect via a mount-effect's own timer"
idiom `futures-page-client.tsx`'s existing 30s spot-price poll already
uses) — never a bare `Date.now()` read inside the render body itself, which
wouldn't self-update and risks an SSR/client mismatch on first paint.
`lastUpdatedAt` is set ONLY at a true network-fetch-success point in
`use-workbench-candles.ts` (both the equity/index branch's `.then()` and
the premium branch's raw-points fetch `.then()`) — deliberately NOT tied to
premium mode's separate candle-aggregation effect, since that effect also
re-fires on a pure client-side interval/bucket-width switch with no real
network round-trip, which would have made the chip lie about freshness on
an interval change alone.

**Gates, all green, 2026-08-06**: tsc clean across apps/web + apps/api +
all 4 packages; eslint clean on every touched file; `npm run ta:check`
86/86 (up from 76/76 — 10 new `computeTechnicalDetail` consistency/skip-
honesty/empty-reason assertions, zero regressions to the 76 pre-existing
ones); `verify-papertrading-engine.ts` 264/264 (untouched — no
`packages/business-rules` import added); `next build` succeeds, First Load
JS for all 3 paper-trading terminal pages **identical to every prior
sprint's own recorded baseline** (136/135/140 kB); `react-loadable-
manifest.json` still exactly ONE dynamic-import entry (3 chunk files),
confirmed via `app-build-manifest.json` that none of the 3 appear in any
terminal page's sync file list — all new files (`signals-table.tsx`,
`signal-reason-trigger.tsx`, `heartbeat-chip.tsx`) correctly landed in the
async workbench chunk. `grep klinecharts` confirms `lib/ta/` stays
klinecharts-import-free (comments/doc-prose only) and every real
`from "klinecharts"` import stays confined to `custom-indicators/`,
`overlays/`, `order-line-overlay.ts`, `kline-chart.tsx`.

**Pre-existing dirty working tree, NOT touched this pass**: `git status`
showed `overlays/{figure-kit,index,legacy-shapes,lines,shapes}.ts`,
`overlays/built-in-stats.ts` (new file), and `custom-indicators/
tooltip-features.ts` as modified/untracked BEFORE this session started —
these are the prior stats-pills founder-feedback pass's own uncommitted
work (per that pass's own memory note: "A DIFFERENT concurrent agent was
editing `custom-indicators/tooltip-features.ts` this session"). Verified
via `git diff --stat` that none of my edits touch these files — flagged
here so a future session doesn't mistake this pre-existing diff for
something this pass introduced.

**Not done this session** (same posture as every prior TA Suite sprint):
live/interactive QA — no dev server/DB/authenticated session, and critically
no OPEN MARKET session available to verify actual live movement end-to-end.
The Monday-market-open checklist (see final report to the founder) is the
required next step: open the workbench on a 1m/5m equity chart during NSE
hours, watch the heartbeat chip tick and confirm it never goes stale under
normal conditions; hover every signal badge in the new table AND the
existing strip to confirm the reason card appears/dismisses correctly on
both desktop hover and a touch device's tap; verify a skipped "needs N
bars" row on a freshly-opened short-history chart, then confirms it flips
to a real signal once enough bars accrue live.

**Files**: `lib/ta/technicals.ts` (rule-table refactor + `computeTechnicalDetail`
+ 3 exported reason builders), `lib/ta/indicator-signals.ts` (`reason` field
on `IndicatorSignal`, wired through all ~40 switch cases), `lib/ta/selfcheck.ts`
(`checkTechnicalDetailConsistency`, 86/86 total); `signals-table.tsx` (new),
`signal-reason-trigger.tsx` (new), `technicals-gauge.tsx` (honesty-line copy),
`chart-workbench.tsx` (`technicalDetail` memo + `<SignalsTable>` +
`<HeartbeatChip>` wiring), `indicator-active-strip.tsx` (badge wrapped in
`SignalReasonTrigger`); `use-workbench-candles.ts` (`pollMsForInterval`,
`lastUpdatedAt`/`pollIntervalMs` in the return shape), `heartbeat-chip.tsx`
(new).
