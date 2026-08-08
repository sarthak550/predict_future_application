---
name: project_ta_suite_s2
description: TA Suite Sprint S2 (indicator library + settings) — 27 built-ins + 14 custom indicators, multi-instance model, settings popover, v1→v2 migration, premium/interval gates. Built 2026-08-02, code-complete, all gates clean. Critical klinecharts indicator-API internals discovered this sprint that S3 (strategies/PF_SIGNALS) depends on.
metadata:
  type: project
---

Built 2026-08-02 per `cto_assignment_brief_ta_suite_s2.md` (T1-T5, direct
assignment like S1 — no CEO/QA pipeline). tsc clean across apps/web +
apps/api + all 4 packages; eslint clean on every touched file; `next build`
succeeds; First Load JS for the 3 paper-trading terminal pages **identical
to S1's own numbers** (136/135/140 kB — zero sync-bundle growth, confirmed
via `app-build-manifest.json`: none of the workbench async chunk's 3 files
appear in any terminal page's sync list); `react-loadable-manifest.json`
still exactly ONE dynamic-import entry. `verify-papertrading-engine.ts`
264/264; `packages/business-rules` git diff empty (S2 never imports it, S3
will). No commits, no schema/db/crontab changes.

**Math verification (Node/tsx, hand-computed fixtures — see [[project_ta_suite_s1]]
memory's "no live browser this session" posture, same here)**: wrote
throwaway `/tmp/verify-*.mts` scripts (klinecharts needs a `window` stub —
`(globalThis as any).window = {navigator:{userAgent:""}}` before dynamic
`import()`, since its `Event.ts` reads `window.navigator` at MODULE-SCOPE
import time, not lazily). `lib/ta/math.ts`'s sma/ema/wilderAtr/stdev/macd
all matched hand fixtures on first try; **rsi() had a genuine off-by-one
seeding bug** caught by the fixture (built on the generic `wilderSmooth`
helper, which is correct FOR `wilderAtr` — every TR value including index 0
is real data — but wrong for RSI, whose `gain[0]/loss[0]` are fake
placeholder zeros; seeding at `period-1` silently averaged only `period-1`
REAL changes instead of klinecharts' own `period`-real-change convention).
Fixed by giving `rsi()` its own seeding loop matching klinecharts' exact
`relativeStrengthIndex.calc` (`dist/index.esm.js:4477-4515`) byte-for-byte.
**STOCHRSI had a real NaN-poisoning bug**: feeding `undefined ?? NaN`
placeholders into `sma()`'s rolling-sum window poisons the sum PERMANENTLY
(`NaN - x` is always `NaN`, never "rolls out" the way a real placeholder
would) — fixed via `compactSma()` (smooth only the defined-value run, map
back onto the sparse index space), used for BOTH K and D smoothing.
SUPERTREND/MFI/CMF/AROON/PIVOTS(both modes)/VWAP(session-reset)/ICHIMOKU
all matched hand-computed or independently-reimplemented-trace fixtures.
AROON's window is `period+1` bars (TA-Lib convention, not `period` — my
first fixture assumed the wrong convention and "failed" until I fixed the
FIXTURE, not the code — worth remembering if this needs re-verifying).

**Verified klinecharts indicator-API internals (load-bearing for S3):**

1. **`createIndicator({id, name, calcParams, paneId?}, isStack)` respects
   an explicitly-passed `id`** (`ChartImp.prototype.createIndicator`,
   `dist/index.esm.js:15107`: `indicator.id ?? (indicator.id = createId(...))`
   — only generates one if you don't supply it) — we generate our own
   `instanceId` client-side and pass it through, giving full control with
   no need to read back a generated value.
2. **`removeIndicator`/`overrideIndicator`'s `{id}` filter matches by id
   ALONE, searching every pane** if no `paneId` is also supplied
   (`StoreImp.prototype.getIndicatorsByFilter`, `dist/index.esm.js:14024`).
   This makes the brief's own speculated "capture returned paneId in a Map
   ref, so removal targets the right pane" **UNNECESSARY** — a documented,
   verified simplification: `kline-chart.tsx`'s `syncIndicatorInstances`
   operates on `id` alone, no paneId bookkeeping anywhere.
3. **Sub-pane instances get a FRESH auto-generated paneId whenever
   `paneId` is omitted from `createIndicator`** (`dist/index.esm.js:15115`)
   — D4's "one indicator instance per pane, no stacking" falls out for
   free, per instance, with zero code.
4. **`overrideIndicator({id, name, calcParams})` recalculates AND
   redraws automatically** — confirmed via `IndicatorImp`'s default
   `shouldUpdate`: `JSON.stringify(prev.calcParams) !== JSON.stringify(current.calcParams)`
   triggers `calc:true`, and `StoreImp.prototype.overrideIndicator` calls
   `_calcIndicator` when that's true. No extra plumbing needed for the T4
   settings popover's "editing a param recalculates immediately" requirement.
5. **`xAxis.convertToPixel(dataIndex)` is PURE LINEAR ARITHMETIC, no
   clamp** (`StoreImp.prototype.dataIndexToCoordinate`, `dist/index.esm.js:13733`:
   `deltaFromRight = dataCount + lastBarRightSideDiffBarCount - dataIndex`)
   — verified BY READING THE SOURCE (no live browser this session) that a
   `dataIndex` 26 bars past the last candle produces a well-defined pixel,
   not `NaN`/undefined/clamped. ICHIMOKU's forward-shifted cloud needed no
   fallback rendering path — direct `xAxis.convertToPixel(i + displacement)`
   inside `draw()` is correct by construction.
6. **`indicator.draw()` returning `false` still lets `figures[]` render
   AFTER it** (`IndicatorView.prototype.drawImp`, `dist/index.esm.js:7899-7911`:
   `isCover = indicator.draw(...); if (!isCover) { ...default figure render... }`)
   — ICHIMOKU exploits this: `draw()` paints ONLY the displaced cloud +
   chikou span (which `figures[]` can't express, no displacement support),
   returns `false`, and the undisplaced tenkan/kijun lines render via the
   normal `figures[]` path for free.
7. **Default `'line'`-type figure rendering draws ONE SEGMENT PER
   `[current, next]` bar pair, each using the CURRENT point's own resolved
   `styles`** (`IndicatorView.prototype.drawImp`, `dist/index.esm.js:7981-8047`)
   — adjacent same-style segments auto-merge into one path; different-style
   segments don't. This means **flip-coloring (SUPERTREND) needs NO custom
   `draw()` at all** — a `figures[].styles` callback returning a
   trend-dependent color is sufficient, klinecharts handles the per-segment
   coloring and merging natively. Flip-marker circles use the SAME
   mechanism: a `circle`-type figure whose `key` is only DEFINED (not
   `undefined`) on flip bars — the default renderer's own
   `isValid(currentData?.[figure.key])` gate skips drawing entirely on
   every other bar, no extra logic needed.

**Instance model as built** (`indicator-registry.ts`): `IndicatorInstance
{instanceId, name, params?}`, selection = `{main: IndicatorInstance[], sub:
IndicatorInstance[]}`. `instanceId` generated client-side
(`crypto.randomUUID` slice + counter fallback), NEVER persisted across
reload (a runtime-only concept — every reload mints fresh ids for restored
instances, since klinecharts indicator instances themselves don't survive a
reload anyway). `kline-chart.tsx`'s indicator effect keys on
`JSON.stringify([instanceId, name, resolveParams(instance)])` per instance
(not the array identity — house render-loop law) via a module-level
`syncIndicatorInstances()` diff helper, unit-tested directly (mock `chart`
object capturing calls) for: two-same-name-different-params add, single-
instance removal leaving siblings untouched, params-only override (not
remove+recreate), zero-calls on an unchanged render, and sub-pane
no-explicit-paneId.

**PIVOTS interval-adaptivity without threading `interval` through
calcParams**: inferred directly from the loaded bars' own median gap
(`inferIsDailyBars()` in `pack-a.ts` — median gap ≥ 20h ⇒ daily/weekly
grouping, else IST-calendar-date session grouping) — self-contained,
independently verifiable from the data alone, no new prop/plumbing needed.
Verified BOTH branches explicitly with hand fixtures (intraday classic
pivots AND weekly-on-1d).

**Deviations flagged for the CEO/founder**:
- Brief's "capture returned paneId in a Map ref" mechanic (item 2 above)
  turned out unnecessary — a verified simplification, not a shortcut.
- WMA/VWMA/HMA placed in the SUB pane per the brief's own explicit,
  twice-stated (brief + plan) T3 list — these are conventionally MAIN-pane
  price overlays everywhere else (TradingView, every other platform);
  implemented literally per the founder-locked instruction rather than
  silently overridden, but worth reconsidering if this surfaces as
  confusing in QA/founder review.
- Indicator-dialog does NOT auto-close after adding an instance (stays open
  so a user can add MA(9) then immediately MA(21) without reopening) — not
  specified either way in the brief, a deliberate UX call.

**Files**: `apps/web/lib/ta/math.ts` (new — sma/ema/wilderAtr/stdev/rsi/macd
+ wma/vwma/hma, pure, hand-verified); `apps/web/components/paper-trading/
workbench/{indicator-registry,indicator-dialog,indicator-active-strip,
indicator-settings-popover}.tsx` (new); `custom-indicators/{pack-a,pack-b,
index}.ts` (new — 14 custom indicators); `kline-chart.tsx` (indicator effect
reworked to the multi-instance model, `syncIndicatorInstances` helper, S2
registration call); `chart-workbench.tsx` (indicator state model, dialog/
strip/popover wiring, restore + interval-change re-sanitize effects);
`indicator-picker.tsx` deleted (zero other importers, confirmed via grep
before deleting).

**How to apply**: S3 (strategies + `PF_SIGNALS`) directly reuses `lib/ta/
math.ts` — it's now hand-verified against fixtures, don't re-derive. S3's
`supertrendFlip` strategy should mirror the exact SUPERTREND algorithm in
`custom-indicators/pack-a.ts` (same flip semantics, same ATR-band formula)
so "what you see is what was tested" (plan's D8) actually holds — read that
file's `supertrend` export, don't reimplement from a textbook formula
independently. S3's `PF_SIGNALS` registered indicator can reuse the same
`registerIndicator`/`draw()`-returns-false-lets-figures-render pattern
established here for its own marker rendering.
