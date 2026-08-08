---
name: project_ta_suite_per_line_indicator_color_fix
description: Founder bug fix (2026-08-04) — indicator Style section rewritten to per-line color swatches (was: one color for the whole instance, the reported bug). Builds on [[project_ta_suite_legends_founder_feedback]].
metadata:
  type: project
---

Direct assignment fixing a real founder-reported bug: "choosing the color in
an indicator makes all the lines the same colour" — e.g. `MA(5,10,30,60)`'s
four lines collapsing to one. Root cause was the legends pass's OWN
documented, deliberate v1 scope decision (`overrideIndicator({styles:{lines:
[oneObject]}}})`'s modulo-indexed resolution recolors EVERY line, by design
at the time) — this pass replaces it with true per-line control.

**Runtime figure discovery, verified, not catalogued.** `chart.getIndicators
({id})[0].figures` (klinecharts' own live `Indicator.figures: IndicatorFigure[]`,
each `{key, title?, type?}`) is the only source of truth. `kline-chart.tsx`'s
new `readLineFigures()` filters `type === 'line'` and assigns a 0-based
`index` in figures[] declaration order — this exactly matches klinecharts'
own `eachFigures` (`dist/index.esm.js:3066`) `lineCount` increment, i.e. the
index a `styles.lines[]` entry must land at to hit that exact figure, proven
by reading the resolution loop directly (`lineStyles[lineCount %
lineStyleCount]`). `figure.title` (e.g. `"MA5: "`, `"UP: "`, `"DIF: "`) is
trimmed of its trailing `": "` for the popover's row label — already correct
per-instance for every built-in (`MA` uses `regenerateFigures` to rebuild
titles from live `calcParams`, e.g. `MA5`→`MA9` after a period edit — verified
`dist/index.esm.js:4122`) and every custom (`custom-indicators/pack-a.ts`/
`pack-b.ts` already declare distinct titles per line). No hand-built
figure-count catalogue exists anywhere in this fix.

**Merge semantics — the actual bug, precisely located.** Two DIFFERENT merge
steps exist, easy to conflate: (1) `IndicatorImp.prototype.override`'s
`merge(this.styles, styles)` — a genuine recursive/index-wise merge (this
codebase's `isObject()` treats arrays as objects too, so merging two arrays
merges by index, not wholesale-replace — verified by reading `merge()`
directly, `dist/index.esm.js:157`). (2) `eachFigures`'s draw-time
`formatValue(styles, 'lines', defaultStyles.lines)` — **this** one IS
all-or-nothing: returns `indicator.styles.lines` in FULL the instant it's
set at all, never per-index-merged with klinecharts' own default palette.
Consequence: submitting a single-element `lines` array (the old v1 approach)
permanently makes `lineStyleCount === 1`, so `lineCount % 1 === 0` for every
line — THAT's the bug, not merge step (1). Fix: every `overrideIndicator`
style call now submits a DENSE array covering every line index
(`buildIndicatorLineStyles`, `indicator-registry.ts`), each entry either the
user's stored override or klinecharts' own default for that index
(`DEFAULT_INDICATOR_LINE_COLORS = ['#FF9600','#935EBD','#1677FF','#E11D74',
'#01C5C4']`, `Color.BLUE = '#1677FF'` — verified character-for-character
against `getDefaultIndicatorStyle()`, `dist/index.esm.js:11405`+`11215`;
confirmed NEVER overridden by this app's own `WORKBENCH_THEME`, which only
sets `indicator.tooltip.features`).

**Persistence — the founder-feedback pass's own flagged gap, now closed.**
`IndicatorInstance.styles?.lines?: Array<LineStyleOverride|null>` is a new,
ADDITIVE field on the existing v2 localStorage shape (`STORAGE_VERSION`
stays `2` — no version bump, no new migration branch; an old blob simply
lacks `styles` per row, already handled by `undefined`-is-fine). Applied at
two points in `kline-chart.tsx`'s `syncIndicatorInstances`: once right after
`createIndicator` (first mount / restore-from-localStorage) and once right
after an `overrideIndicator` calcParams change (`justSynced` gate) — an
UNCHANGED, already-synced instance is deliberately skipped (klinecharts
already carries its styles from the prior pass; re-submitting would be a
harmless but wasteful no-op every render). The instant-apply click path
(swatch click while the popover is open) is a SEPARATE, parallel channel —
`indicatorStyleCommand` nonce, unchanged idiom from the legends pass, now
carrying a properly-typed dense array instead of `Record<string,unknown>`.

**Width — shared, not per-line (CTO judgment call, as the brief explicitly
allowed).** Color needed per-line control to fix the actual bug; width did
not, and per-line width would double the Style section's row count for
`CR` (5 lines) / `MA`/`BBI` (4 lines) for little real value (traders
distinguish stacked lines by color, not thickness). One width control
applies `size` to every current line's stored override in ONE state
transaction (`chart-workbench.tsx`'s `applyIndicatorLineStyle` accepts a
`lineIndices: number[]`, used with either `[oneIndex]` for color or
`figures.map(f => f.index)` for width) — avoids N separate re-renders/
`overrideIndicator` calls for an N-line width pick.

**Edge cases, all handled, none silently dropped:**
- `SUPERTREND`'s one line figure has an unconditional `styles` callback
  returning a trend-based color (`custom-indicators/pack-a.ts`) — per
  `eachFigures`'s own spread order (`{...defaultFigureStyles, ...ss}`), the
  figure's own callback ALWAYS wins on `color`. The popover shows a note
  ("Color follows trend direction — not adjustable") instead of dead
  swatches for that one row (`COLOR_OVERRIDE_IGNORED_NAMES`, currently just
  this one name, doc'd to re-verify before adding another). Width still
  applies (the callback only ever returns `color`).
- `SAR` (circles-only, zero line figures) and any indicator whose
  `figures` array is momentarily empty (not yet synced) render "No
  adjustable line style for this indicator." instead of an empty section.
- Bar-type figures (`MACD`'s histogram, `VOL`'s bars) are structurally
  excluded — `readLineFigures` only collects `type === 'line'`, so `MACD`
  correctly gets exactly 2 rows (DIF/DEA), not 3.
- On-chart legend text colors (klinecharts' native per-pane tooltip, see
  [[project_ta_suite_legends_founder_feedback]]) read the SAME
  `indicator.styles` the fix writes to — confirmed free, no separate work
  needed; they already picked up per-line overrides automatically.

**Architecture note — a read path added alongside the existing command
(write) channel, without a `forwardRef` imperative handle.** The house
render-loop law's "nonce idiom over forwardRef" convention
(`kline-chart.tsx` module doc) is about one-way COMMANDS (parent →
KlineChart, fire-and-forget). Figure discovery is a QUERY that needs a
return value at the moment the popover opens — solved by mirroring the
EXISTING reverse-direction idiom this file already uses for
`onCrosshairDataIndexChange` (KlineChart → parent callback prop, called
inside the same effect that already runs on mount/add/remove/params-change):
new `onIndicatorFiguresChange?: (figures: Map<string, IndicatorLineFigure[]>)
=> void` fires with a FRESH map at the end of the existing indicator-sync
effect (both `syncIndicatorInstances` calls, main + sub, populate ONE shared
map). Deliberately NOT keyed into `mainInstanceKey`/`subInstanceKey` (those
stay `[instanceId, name, resolveParams]` only, never `styles`) — a style-only
change never re-triggers this effect, so the instant-apply command channel
and the persisted-styles-on-sync path can never double-apply or race.

`chart-workbench.tsx`'s `indicatorSettings` state was refactored from
holding a captured `instance` snapshot to holding just `{instanceId, left,
top}`, with the rendered `instance` always looked up fresh from `indicators`
state (`settingsInstance`) — required because the Style section now mutates
persisted React state while the popover stays open for further clicks; a
captured snapshot would show a stale "active" swatch after the first click.

**Gates, all green, 2026-08-04**: tsc clean (apps/web, apps/api,
packages/types, packages/api-client); eslint clean on all 4 touched files
(caught one real unused-import regression — `IndicatorStyle` type left over
after the prop type changed — fixed); `npm run ta:check` 124/124 unchanged
(zero `lib/ta/` files touched this pass); `verify-papertrading-engine.ts`
264/264 (apps/api untouched, run defensively anyway); `next build` succeeds,
First Load JS for all 3 paper-trading terminal pages **identical to the
prior baseline** (136/135/140 kB); `react-loadable-manifest.json` still
exactly ONE dynamic-import entry (3 files); `grep klinecharts` confirms
`kline-chart.tsx` remains the only real `from "klinecharts"` import site in
the workbench, `indicator-registry.ts`'s own mentions stay prose-only
(`DEFAULT_INDICATOR_LINE_COLORS` is a hand-verified mirrored constant, not
an import — klinecharts exposes no runtime accessor for its own theme
defaults).

**Not done this session** (same posture as every prior TA Suite pass): live/
interactive QA — open the workbench, add `MA(5,10,30,60)`, open its
settings, pick 4 different colors across the 4 rows, confirm each line
recolors independently and the OTHERS don't move; reload the page and
confirm all 4 persist; edit `MA`'s period and confirm the colors survive the
figure-title relabel; add `SUPERTREND`, confirm its row shows the note and
width still visibly changes the flip line's thickness; add `SAR`, confirm
"No adjustable line style" renders; add `MACD`, confirm exactly 2 rows
(DIF/DEA), not 3. No dev server/DB/authenticated session available this
session — static verification (tsc/eslint/build/engine/ta:check/manifest
inspection/direct klinecharts source reading for every risky mechanism) was
exhaustive, but a live pass is still the required next step before ship.

**Files**: `apps/web/components/paper-trading/workbench/indicator-registry.ts`
(`LineStyleOverride`, `IndicatorInstance.styles`, `IndicatorLineFigure`,
`DEFAULT_INDICATOR_LINE_COLORS`, `ResolvedLineStyle`,
`buildIndicatorLineStyles`, `sanitizeStoredLineStyles`, v2 migration/
serialize widened additively); `kline-chart.tsx` (`readLineFigures`,
`syncIndicatorInstances` now threads `figuresOut` + re-applies persisted
styles on create/param-change, `onIndicatorFiguresChange` prop,
`indicatorStyleCommand` re-typed to a dense `ResolvedLineStyle[]`, dropped
the now-unused `IndicatorStyle` type import); `chart-workbench.tsx`
(`indicatorSettings` holds an id not a snapshot, `settingsInstance` derived
lookup, `indicatorFigures` state, `applyIndicatorLineStyle` +
`handleApplyIndicatorLineColor`/`handleApplyIndicatorWidth`);
`indicator-settings-popover.tsx` (Style section rewritten: one swatch row
per live line figure + one shared width row, `COLOR_OVERRIDE_IGNORED_NAMES`
for SUPERTREND).
