---
name: project_ta_suite_s1
description: TA Suite Sprint S1 (drawings+toolbar+style editor) — all 42 new tools + toolbar redesign + style editor built 2026-08-02, code-complete, tsc/eslint/build/engine all clean. Critical klinecharts internals discovered this sprint that S2/S3 depend on.
metadata:
  type: project
---

Built 2026-08-02 per `cto_assignment_brief_ta_suite_s1.md` (T1-T7, all in
one pass, no CEO/QA pipeline — a direct assignment, not a sprint-board
ticket). tsc clean across apps/web + apps/api + packages/{validation,types,
api-client}; eslint clean on every touched file; `next build` succeeds;
`react-loadable-manifest.json` still has exactly ONE dynamic-import entry
(`workbench-maximize-button.tsx -> ./chart-workbench`, now 3 chunk files —
klinecharts vendor + 2 app-code chunks, up from W3's 2 — confirmed via
`app-build-manifest.json` that none of the 3 chunk files appear in any of
the 3 terminal pages' sync list); First Load JS for dashboard/futures/
options terminal pages **identical to W3's own numbers** (136/135/140 kB —
zero sync-bundle growth). `verify-papertrading-engine.ts` still 264/264;
`packages/business-rules` `git status` empty. No commits, no schema/db/
crontab changes (the 5 CRUD routes built in W1 already supported
`styles`/merged-patch PATCH bodies with ZERO route changes needed this
sprint — confirmed by reading them, not assumed).

**Critical klinecharts internals discovered this sprint (verified against
`node_modules/klinecharts/dist/index.esm.js`, load-bearing for S2/S3):**

1. **Per-figure style merge order**: `OverlayView.prototype.drawFigures`
   computes `ss = {...defaultStyles[type], ...overlay.styles?.[type],
   ...figure.styles}` — the figure's OWN returned `styles` object wins
   per-KEY over `overlay.styles`. A family file that hardcodes
   `styles:{color:X}` on every figure it returns SILENTLY DEFEATS the T7
   style editor's `overrideOverlay({styles:{line:{color}}})` — the user's
   pick never renders. Fix pattern (`overlays/figure-kit.ts`'s
   `resolveLineColor`/`resolvePolygonColor`/etc): each family file reads
   `overlay.styles` itself and threads the RESOLVED value back into its own
   figure.styles, so "no override" falls back to the family's own default
   and "user picked a swatch" surfaces through the exact same code path.
   S2's indicator settings popover will need the SAME resolver pattern if
   it ever lets a user recolor an indicator's own drawn figures (indicators
   use a different style path — `IndicatorFigureStyle` — but the same
   last-write-wins-per-key merge principle likely applies, verify before
   assuming).

2. **`path` figure attrs are `{x, y, path}`, NOT viewBox-scaled**: `width`/
   `height` are accepted (used only for the figure's own
   `checkCoordinateOnRect` hit-test) but never affect the drawn scale —
   confirmed by reading `drawPath` directly, it destructures only `x/y/path`.
   Critically, `drawPath` offsets EVERY path command's args by the figure's
   own `(x,y)` — uppercase ("absolute") SVG commands get offset too, not
   just lowercase relative ones. Two usage patterns both work: (a) pass
   `x=0,y=0` and embed true absolute pixel coordinates directly in the path
   string (used for `ellipse`'s 2-arc SVG path, `overlays/shapes.ts`), or
   (b) pass the real anchor as `x,y` and use small origin-relative
   coordinates in the path string (used for `flagMark`/`arrowMarkUp/Down`
   glyphs, `overlays/annotations.ts`). SVG `A` (arc) command's own
   x-axis-rotation argument is how a NON-axis-aligned ellipse renders
   without needing a canvas transform the mini path-parser doesn't support.

3. **`performEventMoveForDrawing`/`performEventPressedMove` mutation
   contract**: klinecharts writes the candidate point into
   `this.points[pointIndex]` (or `.value`/`.timestamp`/`.dataIndex` for a
   drag) BEFORE calling the hook — `params.points` IS the live overlay
   points array by reference. Real built-in templates (verified:
   `horizontalStraightLine` at esm.js:11915) mutate `points[i].value`
   in-place inside the hook to re-clamp. `longPosition`/`shortPosition`'s
   stop&lt;entry&lt;target clamp (`overlays/measure.ts`) uses exactly this —
   registered at `registerOverlay()` template scope (module-level), NOT
   passable per-instance through `createOverlay()` (confirmed:
   `OverlayCreate` `Omit`s `performEventPressedMove`/
   `performEventMoveForDrawing` from what a `createOverlay()` call site can
   set — these are template-only fields, same restriction as
   `createPointFigures` itself, see W3 memory's identical finding for that
   one).

4. **`xAxis.convertFromPixel(px)` returns `dataIndex`** (a bar-count
   integer/float, NOT a pixel or calendar value) — the exact inverse of the
   `dataIndexToCoordinate` call that placed a point's pixel `x` in the first
   place. `dateRange`/`fibTimezone`'s bar-offset math (`figure-kit.ts`'s
   `pixelXToDataIndex`) uses dataIndex DELTA instead of the brief's literal
   "timestamp ÷ fixed interval-ms" formula — a deliberate, documented
   deviation: dataIndex arithmetic is immune to BOTH zoom (bar-pixel-width)
   AND calendar gaps (weekends never appear in the loaded array), whereas a
   fixed intervalMs division mis-counts across any 1d-interval weekend gap.
   Proven zoom-invariant by construction (convertToPixel→convertFromPixel is
   an exact round-trip), not just empirically plausible.

5. **`simpleAnnotation` extendData-as-function fix, actually shipped**: the
   built-in `simpleAnnotation` template reads `overlay.extendData` directly
   as display text UNLESS it's a function, in which case it calls
   `overlay.extendData(overlay)` (verified esm.js:12309-12326, matches the
   brief's own ground-truth quote exactly). Fix implemented: persistedId
   moved OFF `extendData` entirely, into an id-keyed side-map
   (`kline-chart.tsx`'s `overlayIdToPersistedIdRef: Map<overlayId,
   persistedId>`) — `getPersistedId()` no longer reads `extendData` at all,
   for ANY overlay type, uniformly (no special-casing). `extendData` is now
   ONLY set (as a closure) for `simpleAnnotation` specifically, rendering
   `resolvePfContent(overlay.styles).text`. Every other overlay (all 61
   others) gets `extendData: undefined` — it was only ever used for this one
   built-in's one quirk.

6. **Built-in `brush`'s own `createPointFigures` deliberately omits
   `color`/`size` from its returned `figure.styles`** (only sets
   `smooth`/`lineCap`/`lineJoin`, esm.js:11782) — confirmed BY READING THE
   SOURCE that `highlighter`'s preset (`overlays/../workbench-toolbar.tsx`'s
   `HIGHLIGHTER_PRESET_STYLES = {line:{color, size:10}}`, passed as
   `createOverlay({name:"brush", styles:...})`) recolors a REAL built-in
   overlay through klinecharts' own native per-type merge with ZERO custom
   code on our side — no `registerOverlay` override needed for `brush`
   itself. D2 ("highlighter = brush alias with preset styles") works
   exactly because of this specific, verified fact about the built-in
   template — don't assume every built-in leaves its color/size open like
   this without checking (e.g. `priceLine`/`fibonacciLine` likely hardcode
   more of their own figure styles; check before reusing this trick
   elsewhere).

**Family-count identity (a load-bearing sanity check, not a coincidence)**:
the plan's toolbar family counts (Lines 12 / Fibonacci 8 / Pitchfork+Gann 7
/ Patterns 11 / Shapes 11 / Measure 5 / Annotations 8 / Emoji 1) sum to
EXACTLY 63 = 62 real overlay names + 1 `highlighter` alias, confirmed by
hand — this fixed the otherwise-ambiguous family assignment for the 6
pre-S1 tools that don't obviously belong to a "new" family:
`abcd`/`xabcd`→Patterns (harmonic patterns, not plain Lines),
`rect`/`arrow`/`brush`→Shapes, `simpleAnnotation`/`simpleTag`→Annotations.
`tool-registry.ts`'s `TOOL_REGISTRY … satisfies Record<ToolbarToolName,
ToolMeta>` makes a missing/misassigned entry a hard `tsc` failure — verified
via an actual negative test (deleted one entry, confirmed `tsc` failed with
the expected `TS1360` error, restored it, confirmed clean again — not just
theorized).

**Deviations flagged for the CEO/founder**:
- `dateRange`/`fibTimezone` use dataIndex-delta instead of the literal
  `timestamp ÷ interval-ms` formula (item 4 above) — functionally
  equivalent-or-better, zoom-invariant by construction, immune to the
  weekend-gap distortion the literal formula would have.
- `priceLabel` was NOT wired to the D10 text popover — its content is
  always the anchor's own formatted price (deterministic), nothing for a
  user to type; the brief's product-gap note listed it as "where editable"
  without specifying what would be editable about a value that's always the
  point's own price.
- Pitchfork variant anchor definitions (`schiff`/`modifiedSchiff`/`inside`)
  are one defensible, internally-consistent, hand-verifiable reading of
  ambiguous terminology (no single canonical source agrees on all 4 exactly)
  — see `overlays/pitchfork-math.ts`'s own doc comment for the exact
  anchor-per-variant table if this needs revisiting.

**Files**: `apps/web/components/paper-trading/workbench/overlays/
{figure-kit,pitchfork-math,catalog,ta-consistency,legacy-shapes,pitchforks,
fibonacci,gann,patterns,shapes,measure,annotations,index}.ts` (all new,
replacing the deleted `custom-overlays.ts`) + `tool-registry.ts`/
`tool-flyout.tsx` (new) + `workbench-toolbar.tsx` (full rewrite) +
`drawing-style-toolbar.tsx`/`drawing-text-popover.tsx` (new) +
`kline-chart.tsx` (extended: persistedId side-map, simpleAnnotation fix,
hydration styles gap fix, 7 new props) + `use-chart-drawings.ts` (widened
create/update signatures, merged-patch debounce) + `chart-workbench.tsx`
(wires all of T5/T6/T7) + `packages/validation/src/chartDrawings.ts` (+42
enum names, family-grouped comments).

**How to apply**: S2 (indicators) and S3 (strategies) both extend
`kline-chart.tsx` and both assume `overlays/`'s directory structure is
stable — it is, this is the final shape, no further renames expected. S2's
indicator settings popover should check item 1 above (the style-merge
order) before assuming a color override "just works" the way it does for
drawings. Runtime/interactive QA (draw each of the 42 tools once, hydrate,
verify styles round-trip, drag-clamp on long/shortPosition, escape-cancel on
the 3 highest-totalStep tools) was NOT run in this session — no dev server/
DB/authenticated session available; static verification (tsc/eslint/build/
engine/negative-test/source-reading) was exhaustive, but the brief's own QA
section's interactive checklist still needs a live pass before this ships.
