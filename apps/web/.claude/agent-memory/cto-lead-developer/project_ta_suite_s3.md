---
name: project_ta_suite_s3
description: TA Suite Sprint S3 (strategies + backtest + PF_SIGNALS + right-panel tabs) — 7 StrategyDefs, gross-vs-net-of-real-costs backtest, chart markers, locked disclaimer. Built 2026-08-02, code-complete, all gates clean. Closes the 3-sprint TA Suite program (S1+S2+S3).
metadata:
  type: project
---

Built 2026-08-02 per `cto_assignment_brief_ta_suite_s3.md` (T1-T5, direct
assignment like S1/S2 — no CEO/QA pipeline). tsc clean across apps/web +
apps/api + all 4 packages; eslint clean on every touched file; `next build`
succeeds; First Load JS for the 3 paper-trading terminal pages **identical
to S1/S2's own numbers** (136/135/140 kB — zero sync-bundle growth,
confirmed via `app-build-manifest.json`: none of the async workbench
chunk's 3 files appear in any terminal page's sync list); async chunk
(`react-loadable-manifest.json`, still exactly ONE dynamic-import entry)
now totals ~358 KB uncompressed across 3 files. `verify-papertrading-
engine.ts` 264/264; `packages/business-rules` git diff empty (imported
READ-ONLY — `computeOrderCosts` only). No commits, no schema/db/crontab
changes. **No S1/S2-only commit checkpoint exists anywhere in git history**
(the whole 3-sprint program has shipped as one uncommitted working tree) —
so the async chunk's S3-ONLY byte delta cannot be isolated from the
combined S1+S2+S3 total; only the sync-bundle invariant (proven exact) is a
true before/after comparison. Recommend committing once S3 QA-passes so any
future sprint has a real diffable baseline.

**`npm run ta:check` — 59 assertions, 0 failed** (`lib/ta/selfcheck.ts`,
`tsx lib/ta/selfcheck.ts`, no new dependency — `tsx` was already an
installed devDependency per the brief's own Verified Ground Truth note).
Negative-case verified explicitly: temporarily corrupted one expected value
in the fixture, confirmed `ta:check` exits non-zero (`npm error code 1`)
and prints the specific failing assertion, reverted, confirmed clean again.
Covers: a hand-traced `maCross[2,3]` fixture (10-bar close series, SMA
values and per-bar states traced by hand in the file's own comment) with
exact signal index/side/price assertions; that same fixture's
`runBacktest()` output cross-checked against REAL `computeOrderCosts()`
calls made in the test itself (imported, not reimplemented) for
entry/exit costs, gross/net PnL, and total costs; an INDEPENDENT
brute-force equity-curve reconstruction (a second, differently-shaped
implementation) cross-checked against `runBacktest`'s own
`maxDrawdownPct`; `buyHoldReturnPct` independence from strategy signals;
0-signal all-zero/null-winRate edge case; a dedicated 1-BUY-only
open-at-end fixture; a qty-min-1 clamp guard; `finalizeSignals`'
leading-SELL-drop + same-side-run-collapse behavior in isolation.

**Strategy signal generation — the "per-bar state, then collapse" pattern**
(the actual design choice this sprint, worth remembering before touching
any of the 7 `compute()`s): every strategy except `rsiReversal` emits ONE
RAW signal per bar wherever a simple binary condition holds (fast MA above
slow MA ⇒ `"BUY"` state, close above the upper Bollinger band ⇒ `"BUY"`
state, etc.) rather than hand-rolled edge/cross detection — the single
shared `finalizeSignals()` post-processor (in `strategies.ts`) then
collapses each maximal same-side run to its first bar, which is
mathematically identical to classic crossover detection but is ONE
independently-verifiable function instead of seven separately-hand-rolled
"was it different last bar" trackers. `rsiReversal` is the deliberate
exception — RSI spends most of its time in the neutral 30-70 zone where
neither reversal state should persist, so it emits true edge-triggered
threshold-crosses directly, still routed through `finalizeSignals()`
defensively. `donchianBreakout`'s rolling high/low window is `[i-period,
i-1]` — the CURRENT bar is deliberately excluded (an inclusive window would
make `close > ownBar.high` impossible by construction, a real
first-draft bug caught before it shipped).

**`supertrend()` promoted from `custom-indicators/pack-a.ts` into
`lib/ta/math.ts`** (S3 refactor, not just a new addition) — the brief's
"sharing math.ts supertrend" phrase plus S2's own memory note ("mirror the
exact SUPERTREND algorithm in pack-a.ts, don't reimplement independently")
both pointed at the same fix: rather than have `supertrendFlip` re-derive
the ATR-band algorithm from a textbook formula (a real WYSIWYG risk per D8
— "what you see is what was tested"), the calculation body moved to
`math.ts` and `pack-a.ts`'s `SUPERTREND` indicator now calls it too. Both
consumers are now byte-identical by construction, not by discipline.

**PF_SIGNALS non-interactivity is a STRUCTURAL guarantee, not a tested
behavior** (verified by reading `IndicatorView.prototype.drawImp`,
`dist/index.esm.js:7877-7911`, same posture as every other klinecharts
internals claim this program has made): an indicator's `draw()` callback is
invoked for its `ctx` side effect only — its return value ONLY decides
whether `figures[]` also renders afterward; nothing about `draw()` (or
`figures[]`) ever registers a click/drag hit-test target anywhere in
klinecharts core. Interactive hit-testing for this chart lives in two
OTHER, structurally disjoint code paths: `OverlayView`/`_chartStore`'s
overlay list (S1 drawings + `order-line-overlay.ts`'s draggable order
lines, both `createOverlay`-based) and the chart's own raw `click` DOM
listener (`kline-chart.tsx`'s `handleClick`, click-to-trade).
`custom-indicators/pf-signals.ts` paints ▲/▼ markers ENTIRELY inside
`draw()` with `figures: []` (empty) and returns `true` — there is no
code path through which it COULD intercept a click, by construction, not
because it was tested and happened not to. Placement: BUY markers anchor
off the bar's own `low` (not the signal's entry/exit PRICE, which is a
close and can sit mid-candle), SELL off the bar's `high` — reads correctly
as "below/above the bar," not "below/above wherever price happened to
close."

**Right-panel tabs — the disclaimer needed its own DOM position, not just
CSS-hidden with the rest of the Strategy tab.** A naive `[Ticket |
Strategy]` implementation would CSS-hide the WHOLE Strategy panel
(disclaimer included) the moment the user switches back to Ticket — which
fails the brief's own explicit "disclaimer must remain visible in BOTH tab
states" acceptance criterion. Fix: `strategy-panel.tsx` exports two
SEPARATE presentational pieces — `StrategyConfigPanel` (select/params/
notional/Run/stats card, tab-scoped, CSS-hidden like the ticket) and
`StrategyDisclaimerFooter` (the amber disclaimer + scope note + Clear
signals, rendered by `chart-workbench.tsx` in its OWN position, OUTSIDE
either CSS-hidden wrapper, gated only on `hasOpenedStrategyTab` — a sticky
boolean that never resets false once the Strategy tab is first opened).
Both pieces are fully controlled (zero internal state) — all strategy
state (`strategyId`/`strategyParams`/`strategyNotional`/`strategyRunResult`)
lives in `chart-workbench.tsx`, same ownership pattern as the existing
indicator-selection state.

**On-chart markers vs. the stats card can go out of sync on their own —
by DESIGN, not a bug to fix.** `signalsConfig` (fed to `KlineChart`) is
derived from `strategyRunResult.{id,params}` — the LAST-RUN pair — never
from the live (possibly since-edited) `strategyId`/`strategyParams` state.
This means editing a param after a run does NOT move the markers until
Run is clicked again (keeps markers and stats describable as "the same
run," never a markers-updated-live/stats-frozen mismatch). Separately,
`PF_SIGNALS`' own `calc` recalculates fresh from whatever `dataList` the
chart CURRENTLY holds on every render — so an INTERVAL change (not a param
edit) self-corrects the markers automatically (they're just a live
indicator), while the stats card's numbers are a point-in-time snapshot
that goes stale. `strategy-panel.tsx`'s `isStale` check
(`runResult.ranInterval !== interval`) surfaces this explicitly as a
banner on the stats card rather than silently showing wrong numbers,
satisfying T4's "never silently runs a backtest against candles from a
different interval than the stats card claims" — chosen to RE-LABEL as
stale rather than clear the run entirely (both were valid per the brief's
own phrasing), since the on-chart markers stay correct either way and
hiding the stats felt like more information loss than a banner.

**Disclaimer copy — a flagged, not silent, reconstruction.** The
founder-locked plan's own draft elides two clauses with "…" (`"full
hindsight…"` and `"discount-broker rates…"`). Filled with minimal
connective language in the same voice `paper-trading-disclaimer-footer.tsx`
already uses ("may not match what your real broker would charge" →
mirrored here) — every EXPLICIT clause the plan states is reproduced
verbatim; only the elided connective words are new. Flagged for founder
sign-off on exact wording, same posture S1 used for its own ambiguous-spec
deviations.

**WMA/VWMA/HMA orchestrator correction** (S2's brief had placed them
sub-pane per an explicit, twice-stated instruction that S2's own memory
already flagged as worth reconsidering): moved to `pane: "main"` in
`indicator-registry.ts`'s `CUSTOM_REGISTRY`. `custom-indicators/pack-b.ts`
itself is UNCHANGED (pane placement is entirely a `createIndicator
({paneId})` caller-side concern, not an `IndicatorTemplate` concern).
Added `reclassifyByPane()` — a name-agnostic safety net applied at the end
of BOTH `migrateStoredSelection()` branches (v1 and v2) — that re-sorts
every restored instance by its CURRENT registry `pane` value, moving
anything found under the "wrong" list. This means an old
`pf.workbench.indicators` blob with WMA/VWMA/HMA still filed under `sub`
(written before this sprint) is corrected to `main` on the very next
restore — never dropped, never left desynced from
`kline-chart.tsx`'s `paneId: MAIN_PANE_ID` sync call for `mainIndicators`.
The same helper would transparently absorb any FUTURE pane reassignment
too, not just this one.

**Deviations flagged for the CEO/founder**:
- Disclaimer copy's elided clauses filled with connective language (see
  above) — needs founder confirmation of exact final wording.
- The async-chunk build-size "diff" (T5 gate) could only be reported as an
  absolute current total, not a true S3-only delta — no S1/S2-only commit
  checkpoint exists to diff against (see the build-gates paragraph above).
  The proven, load-bearing part of this gate (sync-bundle invariant) IS
  exact and unaffected by this.
- `rsiReversal` uses true edge-triggered threshold-crossing rather than the
  "per-bar state + finalize" pattern every other strategy uses — a
  deliberate exception (RSI's neutral zone has no natural persistent
  "state"), not an inconsistency.

**Files**: `apps/web/lib/ta/{strategies,backtest,selfcheck}.ts` (new),
`lib/ta/math.ts` (+`supertrend()`, promoted from `pack-a.ts`);
`apps/web/components/paper-trading/workbench/custom-indicators/pf-signals.ts`
(new); `strategy-panel.tsx` (new — `StrategyConfigPanel` +
`StrategyDisclaimerFooter` + the `pf.workbench.strategy` localStorage
helpers); `custom-indicators/pack-a.ts` (SUPERTREND `calc` now calls the
shared `math.ts` function); `indicator-registry.ts` (WMA/VWMA/HMA →
`pane: "main"` + `reclassifyByPane()`); `kline-chart.tsx` (`signalsConfig`
prop + PF_SIGNALS single-instance sync effect, same JSON-keyed idiom as
S2's indicator effect); `chart-workbench.tsx` (right-panel `[Ticket |
Strategy]` tabs, strategy state, `handleRunStrategy`/`handleClearSignals`);
`apps/web/package.json` (+`ta:check` script).

**How to apply**: this closes the 3-sprint TA Suite program (S1 drawings +
S2 indicators + S3 strategies/backtest). Per house discipline (Limit
Orders, Charting Workbench precedent), report to CEO for a 30-day usage
review before proposing further TA-suite scope — specifically whether the
gross-vs-net backtest framing changes real trading product-type choices,
per the brief's own program-completion note. Runtime/interactive QA (open
the workbench, run each of the 7 strategies, verify marker placement,
verify tab-switch ticket-draft preservation, verify disclaimer survives a
reload) was NOT run this session — no dev server/DB/authenticated session
available; static verification (tsc/eslint/build/engine/ta:check/manifest
inspection/source-reading) was exhaustive, but the brief's own QA
checklist still needs a live pass before this ships.
