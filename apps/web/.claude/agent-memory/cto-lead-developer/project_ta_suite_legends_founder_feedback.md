---
name: project_ta_suite_legends_founder_feedback
description: TA Suite founder-feedback pass (2026-08-04) — TradingView-grade on-chart indicator legends + crosshair-follow (Part 1), abcd/xabcd ratio labels + measure-tool audit (Part 2), flyout viewport fit (Part 3). Builds on [[project_ta_suite_signals_rating]].
metadata:
  type: project
---

Built 2026-08-04 as a direct assignment (not sprint-board pipeline), same
posture as every prior TA Suite pass. Founder's three-part ask: on-chart
per-pane indicator legends with interactive eye/gear/remove + crosshair-
follow (Part 1), value-space ratio labels on `abcd`/`xabcd` + an audit of
every measuring tool for missing numeric readouts (Part 2), and a viewport-
overflow fix for bottom-family toolbar flyouts (Part 3).

**Part 1 — the legend mechanism, verified before building anything.**
klinecharts' own per-pane top-left indicator tooltip (`IndicatorTooltipView`)
ALREADY implements TradingView's on-chart legend natively: `name(params)` +
one colored legend row PER `figures[]` entry with a `title`, reading
`result[crosshair.dataIndex]` — verified against `dist/index.esm.js`'s
`getIndicatorTooltipData` (~line 7090). `styles.indicator.tooltip.showRule`
defaults to `"always"`, and an untouched crosshair resolves to the LAST bar
(`StoreImp.prototype.setCrosshair`'s own `{}`-input branch) — so "null
crosshair -> latest bar" is klinecharts' OWN default, not something built
this pass. Every custom indicator whose figures already declare `title`
(all of them except `PF_SIGNALS`, deliberately non-interactive/legend-less)
got this legend for FREE from S2 — this pass's only real addition is the
INTERACTIVE eye/gear/remove icons.

**Features ARE a real click path, not render-only** — the brief's own
explicit fork was resolved by reading source, not assumed:
`IndicatorTooltipView.prototype.drawStandardTooltipFeatures`'s
`_featureClickEvent` wires each feature's `mouseDownEvent` to
`chart.getChartStore().executeAction('onIndicatorTooltipFeatureClick',
{paneId, feature, indicator})` — a genuine action dispatch, confirmed
against `dist/index.d.ts`'s own `ActionType` union
(`"onIndicatorTooltipFeatureClick"`). The DOM-overlay fallback the brief
offered as a contingency was never needed.

**Icon glyphs**: no icon font exists anywhere in this codebase (lucide-react
SVG components everywhere else, unusable inside a canvas-drawn tooltip).
`TooltipFeatureStyle`'s `type: "path"` uses klinecharts' own hand-written
mini SVG path parser (`drawPath`, `dist/index.esm.js:5753`) — verified to
support `M/L/H/V/C/S/Q/T/A/Z` (upper+lower) AND multiple `M` subpaths within
ONE path string (confirmed: each `M` is just `ctx.moveTo` inside a single
shared `ctx.beginPath()`/`ctx.stroke()` pair) — exactly what the gear
glyph's 6 disconnected spokes need. New file `custom-indicators/
tooltip-features.ts` hand-authors 12×12 eye/gear/×(remove) glyphs, `style:
"stroke"` (one fill-or-stroke choice for the WHOLE path string, confirmed —
no per-subpath style).

**Global style default, not per-instance createTooltipDataSource** — the
only architecturally sound approach: `chart.setStyles({indicator:{tooltip:
{features}}})` in `kline-chart.tsx`'s `WORKBENCH_THEME` seeds
`tooltipData.features` for EVERY indicator whose own
`createTooltipDataSource` doesn't return its own (verified: a custom
`features` return only wins if `isValid(customFeatures)`, i.e. present at
all — an empty array still counts as "valid" and overrides). This covers
all 27 built-ins (which cannot and must not be reimplemented just to attach
a callback) + 13 of 14 customs automatically. Only `ICHIMOKU`
(`custom-indicators/pack-a.ts`) has its own `createTooltipDataSource` and
had to explicitly re-export the SAME `INDICATOR_TOOLTIP_FEATURES` array
(previously returned `features: []`, which would have silently dropped the
icons). `PF_SIGNALS` (`pf-signals.ts`) was deliberately left untouched —
its own `features: []` return correctly keeps it icon-less (it's not a
user-managed strip instance; giving it eye/gear/remove would be misleading
since the click handler wouldn't find it in `mainIndicators`/`subIndicators`
anyway).

**A real, documented limitation of the global-style approach**: icon
APPEARANCE is static — can't visually reflect e.g. "this instance is
currently hidden," since only a per-indicator `createTooltipDataSource`
(infeasible for all 27 built-ins) has `indicator.visible` at style-build
time. The CLICK still correctly toggles visibility; klinecharts' own default
legend behavior already signals "hidden" for free (a hidden indicator's
VALUE legends go empty while the name/features row stays, per the same
`getIndicatorTooltipData` function's `if (indicator.visible) {...legends...}`
gate) — not fixed, a verified-sufficient existing behavior.

**Click routing**: `kline-chart.tsx` subscribes to
`onIndicatorTooltipFeatureClick` once in the mount effect. Eye toggle is
FULLY self-contained (`chart.getIndicators({id})` read + `overrideIndicator
({id, name, visible: !cur.visible})` — `name` is a REQUIRED field on
`overrideIndicator`'s own `IndicatorCreate` type even when only toggling
`visible`, a real gotcha caught by tsc, not by inspection) — no React state
round-trip, matching the eye-state's own chart-only, ephemeral nature (never
persisted, same posture as every other klinecharts-internal-only state in
this program). Gear routes to the SAME `onIndicatorOpenSettings(instance,
anchor)` callback the strip's own gear button already calls — `instance` is
resolved via a per-render-refreshed `allIndicatorInstancesRef` (mirrors
`[...mainIndicators, ...subIndicators]` every render, read only inside the
event closure); `anchor` is `chart.getSize(paneId)`'s own top-left + a small
fixed offset, since the native click payload carries NO pixel coordinate at
all (`featureInfo = {paneId, feature, indicator}` only, verified) — a
documented, honest approximation of "near where you clicked," not
pixel-exact. Remove routes to `onIndicatorRemove(instanceId)` ->
`chart-workbench.tsx`'s EXISTING `handleRemoveIndicator` (React state) —
deliberately NEVER a raw `chart.removeIndicator` call from inside
`kline-chart.tsx`, since the existing `syncIndicatorInstances` effect would
just recreate whatever a raw removal deleted, on the very next render.

**Click-vs-click-to-trade collision, found and fixed**: the on-chart
tooltip features are canvas-drawn INSIDE the same container `el` whose
native `click` listener already drives click-to-trade
(`onSurfaceClick`/order-intent popover) — clicking an icon would ALSO fire
that listener for the SAME physical click (klinecharts' own mousedown-based
feature handling doesn't stop native event propagation, and a synthesized
`click` always follows `mousedown`+`mouseup` on the same element
regardless). Fixed with a `suppressNextClickRef` set SYNCHRONOUSLY inside
the feature-click handler — safe specifically because that handler is wired
to `mouseDownEvent` (verified), which always fires strictly BEFORE the
browser's own `click` for the same gesture — the exact same "set a ref in
an earlier event, read it in a later one" idiom `dragJustEndedRef` already
uses one line above it.

**Crosshair-follow — TWO separate, independently-verified mechanisms, not
one.** The on-chart legend needs NONE of this (native, above). The DETACHED
strip (`indicator-active-strip.tsx`) has no native equivalent — a plain DOM
row outside the canvas — so `kline-chart.tsx` subscribes to
`chart.subscribeAction('onCrosshairChange', ...)` itself. **Load-bearing
gotcha #1, verified by reading source, not assumed**: the payload that
action callback receives is NOT the fully-resolved crosshair.
`StoreImp.prototype.setCrosshair` calls `this.executeAction
('onCrosshairChange', crosshair)` using its OWN raw INPUT parameter
(`{x, y, paneId}`, exactly what `Event.prototype.mouseMoveEvent` passes for
the main pane) — never the internally-resolved `this._crosshair` (which DOES
carry `dataIndex`/`kLineData`, but is not reachable from the public
`Chart`/`Store` interface at all: no `getCrosshair` method exists on
EITHER). Fixed by re-deriving `dataIndex` from the raw `x` via
`chart.convertFromPixel([{x}], {paneId})` — verified `ChartImp.prototype
.convertFromPixel` DOES populate `point.dataIndex` (via the same
`coordinateToDataIndex`/`xAxis.convertFromPixel` the internal resolution
path itself uses) — a real, exact public-API equivalent, not a workaround.
**Gotcha #2**: klinecharts' own `mouseleave` clear (`setCrosshair()` with no
args) does NOT fire the action at all — the cleared `{}` crosshair's
`paneId` is `undefined`, failing the `isString(this._crosshair.paneId)`
gate `setCrosshair` checks before calling `executeAction`. Fixed with this
file's OWN `mouseleave` listener on the container, independent of
klinecharts' internal action system, nulling the hover ref directly.
rAF-throttled (`crosshairRafRef`, matches the house render-loop law's
"throttle high-frequency chart events via rAF" convention).

`computeIndicatorSignal` (`lib/ta/indicator-signals.ts`) gained an optional
`atIndex` param — MINIMAL-RISK design: the function shadows its own
parameter with a truncated slice (`allCandles.slice(0, atIndex+1)`) under
the SAME local name `candles` the ~40 existing `switch` cases already read
`last(...)`/array-end values off, so every case is correct for an arbitrary
hover position with ZERO changes to the cases themselves — `atIndex`
omitted (every `ta:check` fixture call) is byte-identical to before,
confirmed by `ta:check` staying 76/76 unchanged.

**Settings popover STYLE section** — a real, deliberately-scoped decision
after verifying indicator style-override semantics are WORSE than the S1
overlay merge (per-key-wins) this program already knew about:
`overrideIndicator({styles:{lines:[...]}})`'s `lines[]` REPLACES THE WHOLE
ARRAY wholesale (`eachFigures`'s `formatValue(styles, 'lines',
defaultStyles.lines)` = `styles?.lines ?? defaultStyles.lines`, no per-index
merge with the built-in default), and each line-type figure resolves via
`lineStyles[lineCount % lineStyleCount]` — a MODULO, not a direct index.
Submitting a single-element `lines` array therefore UNIFORMLY recolors/
resizes EVERY line figure of an instance (`lineCount % 1 === 0` always) —
exploited deliberately: the STYLE section applies ONE color + ONE width to
the WHOLE instance, not independent per-sub-line control (which would need
a verified line-count catalogue for all 27 built-ins + 14 customs — scoped
out, flagged as a real follow-up, not silently narrowed). One flagged
interaction: `SUPERTREND`'s own line figure has a `styles` callback that
UNCONDITIONALLY returns a trend-based `color` — per the same merge order, a
picked COLOR is a silent no-op for SUPERTREND specifically (by design, the
flip color IS the signal) while WIDTH still applies.

**Part 2 — ratio labels.** `abcd`/`xabcd` (`overlays/legacy-shapes.ts`)
gained value-space, 3-decimal (`formatRatioLabel`, new in `figure-kit.ts`)
retracement/completion labels at each leg's midpoint: `abcd` shows BC/AB at
BC's midpoint and CD/BC at CD's midpoint; `xabcd` shows B=AB/XA at AB's
midpoint, C=BC/AB at BC's, D=CD/BC at CD's, plus an XAD completion ratio
(`|AD|/|XA|`) near D — all computed off `overlay.points[i].value` (real
anchor prices), matching `cypher`'s own pre-existing ratio-label convention
from the founder-feedback markers pass (`buildRatioLabeledZigzag`), not
reinvented.

**Audit** (every measuring-capable tool, verified by reading its
`createPointFigures`):

| Tool | Numeric readout | Action |
|---|---|---|
| `abcd` | letters only | ADDED: BC/AB, CD/BC ratios |
| `xabcd` | letters only | ADDED: B/C/D retracement ratios + XAD |
| `trianglePattern` | none | none needed (brief's own call) |
| `headAndShoulders` | letters + neckline only | ADDED: measured-move target (mirrors head's excess above/below the fitted neckline, sign-correct for both topping and inverse patterns) |
| `cypher`/`threeDrives`/Elliott ×5 | already ratio-labeled (cypher) / plain zigzag (rest, by design — no established ratio convention for these) | none needed |
| `fibExtension` | ✓ ₹ via `levelLine` | none needed |
| `fibChannel` | %-only, NO ₹ | ADDED: `yAxis.convertFromPixel(y)` price alongside the existing % label |
| `fibFan`/`fibArc`/`fibCircle`/`fibSpeedResistanceFan`/`fibSpeedResistanceArcs`/`fibWedge`/`pitchfan` | % labels only (no natural ₹ reading for a fan/arc/circle geometry) | none needed — consistent with how every OTHER charting platform labels these |
| `fibTimezone`/`trendBasedFibTime` | bar-count labels (not price) | none needed — these are TIME tools by design |
| `gannFan` | ✓ ratio labels (1×8…8×1) | none needed |
| `gannSquareFixed` | ✓ ₹/bar label | none needed |
| `gannBox`/`gannSquare` | grid only, no labels | out of scope — brief's own audit line only named `gann (fractions labeled)`, i.e. `gannFan`, already satisfied |
| `priceRange` | ✓ Δ₹ + Δ% | none needed |
| `dateRange` | ✓ bar count | none needed |
| `datePriceRange` | ✓ Δ₹ + Δ% + bars | none needed |
| `longPosition`/`shortPosition` | ✓ R:R + target/stop % chip | none needed |
| `sector`/`anchoredVWAP` | not named in the brief's audit list | not touched |

**Part 3 — flyout viewport fit.** `tool-flyout.tsx` now accepts an
`anchorRect` (the trigger button's own `getBoundingClientRect()`, captured
by `workbench-toolbar.tsx` at click time in both call sites — family
buttons AND the search icon) and, in a `useLayoutEffect`, measures its OWN
just-rendered height and shifts `top` UP (inline style, never past an 8px
viewport-top margin) by exactly the overflow past `window.innerHeight - 8`.
The pre-existing `max-h-[70vh] overflow-y-auto` (unchanged, S1-era) stays as
the second, independent layer — catches a flyout genuinely taller than the
viewport even after shifting fully up. Escape/outside-click/select-close
(the prior founder-bug-fix pass) are untouched — no structural change to
`workbench-toolbar.tsx`'s pointerdown/keydown effect.

**Gates, all green, 2026-08-04**: tsc clean across apps/web + apps/api +
all 4 packages; eslint clean on every touched file; `npm run ta:check`
76/76 (unchanged — `indicator-signals.ts`'s `atIndex` addition is provably
a no-op for every existing call, confirmed by the count staying identical);
`verify-papertrading-engine.ts` 264/264 (untouched, `packages/business-
rules` never imported this pass); `next build` succeeds, First Load JS for
all 3 paper-trading terminal pages **identical to every prior sprint's own
baseline** (136/135/140 kB, confirmed via `app-build-manifest.json` that
none of the 3 async chunk files appear in any terminal page's sync list);
`react-loadable-manifest.json` still exactly ONE dynamic-import entry (3
chunk files); async chunk total ~416 KB uncompressed (up from the
signals/rating pass's ~401 KB — expected: new `tooltip-features.ts` module
+ settings-popover STYLE section + crosshair-follow wiring + ratio-label
additions). `grep klinecharts` confirms the import stays confined to the
workbench async chunk; `lib/ta/` stays klinecharts-import-free (comments
only, `indicator-signals.ts`'s own doc references are prose, not imports).

**Deviations flagged for the founder**:
- On-chart legend eye/gear icons are visually STATIC (can't reflect a
  specific instance's hidden state or open-settings state) — a real
  architectural limit of the global-style-default approach (see above), not
  an oversight. Clicking still correctly toggles/opens.
- Gear-click popover anchor is an APPROXIMATION (pane top-left + fixed
  offset), not pixel-exact — the native click payload carries no
  coordinate at all (verified).
- Settings popover's STYLE section recolors/resizes the WHOLE instance
  uniformly, not independently per sub-line (e.g. Keltner's upper/middle/
  lower can't get 3 different colors this pass) — a scoped, documented v1;
  independent-per-line control needs a verified line-figure-count catalogue
  for all 27 built-ins, a real follow-up.
- `SUPERTREND`'s own flip-color figure silently ignores a picked STYLE
  color override (by design — flip color is the signal itself); width still
  applies.
- `headAndShoulders`' new measured-move target uses the classic mirror-the-
  neckline formula (one of several textbook variants — some use the
  right-shoulder breakout point instead of the head's own x for the
  neckline reference) — a defensible, standard choice, not the only one.

**Not done this session** (same posture as every prior TA Suite sprint):
live/interactive QA (open the workbench, hover the crosshair across several
indicator instances and verify both the on-chart legend AND the detached
strip track the SAME bar; click eye/gear/remove on the on-chart legend;
pick STYLE colors/widths and verify `overrideIndicator` visually applies;
draw `abcd`/`xabcd`/`headAndShoulders` and eyeball the new ratio/target
labels; open a bottom-family flyout — Measure/Annotations/Emoji — near the
bottom of a real viewport and confirm it no longer clips) — no dev server/
DB/authenticated session available. Static verification (tsc/eslint/build/
engine/ta:check/manifest inspection/direct klinecharts source reading for
every risky mechanism) was exhaustive, but a live pass is still the
required next step before this ships, per house discipline.

**Files**: `apps/web/components/paper-trading/workbench/custom-indicators/
tooltip-features.ts` (new — feature glyphs + ids); `pack-a.ts` (ICHIMOKU
`features` re-export); `kline-chart.tsx` (crosshair-follow subscription +
rAF throttle, feature-click subscription + suppress-next-click guard,
`indicator.tooltip.features` global style default, `indicatorStyleCommand`
effect, 4 new props); `chart-workbench.tsx` (`hoveredDataIndex` state,
`instanceSignals` now keyed on it too, `indicatorStyleCommand` state/
handler, new `<KlineChart>`/`<IndicatorSettingsPopover>` props);
`indicator-settings-popover.tsx` (STYLE section — swatches + widths, reuses
`SWATCH_COLORS`/`LINE_WIDTHS`); `lib/ta/indicator-signals.ts`
(`computeIndicatorSignal` gains `atIndex`); `overlays/{legacy-shapes,
patterns,fibonacci,figure-kit}.ts` (ratio/target/₹ labels); `tool-flyout.tsx`
(`anchorRect` prop + viewport-fit `useLayoutEffect`); `workbench-toolbar.tsx`
(`anchorRect` state, both click sites capture+pass it).

**How to apply**: `IndicatorInstance` (`indicator-registry.ts`) was
deliberately NOT widened with a `visible`/`styleOverride` field — both live
entirely inside klinecharts (read via `chart.getIndicators`), never
round-tripped into React state/localStorage. Any FUTURE work wanting to
persist an indicator's visibility/style across a reload would need to
change that design choice explicitly, not assume it already persists.

**POST-SHIP BUG FOUND + FIXED (2026-08-04, same day, founder screenshot
report)**: a thick gray diagonal line smeared across every pane's legend,
crossing the legend values, from roughly the legend's start through the ×
icon. Root cause — a REAL klinecharts@10.0.1 library bug in its own
hand-written SVG mini path parser, confirmed by reading `dist/index.esm.js`
directly (not assumed): `drawPath`'s per-command loop declares
`currentX`/`currentY`/`startX`/`startY` with `var` INSIDE the
`commands.forEach` callback — a FRESH `0` on EVERY command, never carried
over from a preceding command's own assignment. Harmless for `M`/`L`/`C`/`Q`/
`Z` (each computes an absolute target from `args+offset` and calls
`ctx.moveTo`/`lineTo`/`bezierCurveTo`/`quadraticCurveTo` directly — the
canvas's OWN internal path pointer drives drawing, not klinecharts' JS
variable). FATAL for `A` (arc): `drawEllipticalArc(ctx, x1, y1, args,
offsetX, offsetY, isRelative)` uses `x1`/`y1` RAW/unoffset as the arc's
start point (`ellipticalArcToBeziers(x1, y1, ...)`) — only the END point
(`x2+offsetX`, `y2+offsetY`) gets translated. Since `currentX`/`currentY`
are always `0` on the iteration an absolute `A` command runs, EVERY `A` in
the original eye-pupil/gear-ring glyphs started its arc at canvas-absolute
`(0,0)` (the chart's own top-left corner) and swept to the correctly-offset
endpoint near the real icon — a multi-hundred-pixel diagonal bezier. The ×
icon (M/L only) was never exposed to this, matching the founder's own "the
× renders fine" observation exactly. **Also broken for the identical
reason** (not currently used anywhere in this codebase, flagged for any
FUTURE path-glyph author): `S`/`T` (pass `currentX`/`currentY` as explicit
`bezierCurveTo`/`quadraticCurveTo` args), `H`/`V` (need the OTHER axis's
carried-over value), and every lowercase RELATIVE command (`l`/`c`/`q`/`a`/
etc — `currentX += args[0]` against a value that's always `0`). **The only
safe commands in this klinecharts version's `path` figures are absolute
`M`/`L`/`Q`/`C`/`Z`** — this supersedes (does NOT contradict, just narrows)
the founder-feedback pass's own earlier doc claim that `drawPath` "supports
M/L/H/V/C/S/Q/T/A/Z, upper and lower case" — that claim was about the
regex SPLITTING the command string correctly (true), not about every
command being SAFE to use given this scoping bug (false for the 7 listed
above). Fix: `custom-indicators/tooltip-features.ts`'s eye pupil rebuilt as
a small diamond (`M/L/Z`) instead of 2 `A` arcs; the gear ring rebuilt as a
regular octagon (`M/L/Z`, 8 vertices at 45° steps) instead of 2 `A` arcs;
the 6 gear spokes and the × glyph were already `M`/`L`-only and untouched.
Also tightened `size: 11 -> 12` to exactly match the glyphs' own 0–12
coordinate space (a minor separate polish, not the bug's cause). Worked
around, never patched — `node_modules` is never edited in this codebase.
Gates re-verified after the fix: tsc/eslint clean, `next build` succeeds,
First Load JS unchanged (136/135/140 kB).
