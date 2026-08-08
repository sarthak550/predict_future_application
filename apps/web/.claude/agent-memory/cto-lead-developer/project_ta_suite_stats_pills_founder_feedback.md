---
name: project_ta_suite_stats_pills_founder_feedback
description: TA Suite founder-feedback pass (2026-08-05) — TradingView-parity stats pills (Δ/%/bars, price/date pins, channel width) added to 11 klinecharts BUILT-IN line overlays via verified same-name registerOverlay override, plus arrow/arrowMarker/flatTopBottom/disjointChannel. Builds on [[project_ta_suite_legends_founder_feedback]].
metadata:
  type: project
---

Built 2026-08-05 as a direct assignment (not sprint-board pipeline), same
posture as every prior TA Suite pass. Founder: "all the ratios in trend
lines are still not there — look at TradingView very closely." A DIFFERENT
concurrent agent was editing `custom-indicators/tooltip-features.ts` this
session — never touched, confirmed via `git status` before and after.

**The core mechanism question, resolved with dist evidence, not assumed**:
does `registerOverlay({name: "segment", ...})` override a klinecharts
BUILT-IN of the same name? YES — `dist/index.esm.js`'s own built-in
registration (`extensions.forEach(t => overlays[t.name] = OverlayImp.extend
(t))`) and `registerOverlay` itself (`overlays[template.name] = OverlayImp
.extend(template)`) are the SAME plain object-key assignment into the SAME
`overlays` registry, and the built-ins populate it at klinecharts' own
module-init time — always strictly before any app code runs. Same-name
re-registration is a full, clean override: same `DrawingOverlayName`, same
enum, same toolbar entry, same persistence shape, zero wrapper-name
fallback needed. This was the harder of the two open mechanism questions
the brief posed, and it resolved cleanly on the first read of the actual
registration code — worth remembering for ANY future "can we override a
klinecharts built-in" question, the answer is unconditionally yes via
same-name `registerOverlay`.

**The other open mechanism question — stats visibility "while DRAWING and
when SELECTED"**, also resolved with dist evidence:
1. **Drawing**: `overlay.currentStep` is a REAL field on the public
   `Overlay<E>` type (not hidden), and `-1` means finished
   (`OVERLAY_DRAW_STEP_FINISHED`, verified in the step machinery). The
   `overlay` object `createPointFigures` receives IS the live instance, so
   reading `.currentStep` needs no tracking, no cast, always current.
2. **Selected**: the public `Overlay` type has NO `selected` boolean and
   neither `Chart` nor `Store` expose a "currently selected overlay"
   getter. The ONLY reachable signal is `onSelected`/`onDeselected`
   template callbacks. Verified these are RELIABLE, not a guess:
   `StoreImp.prototype.setClickOverlayInfo` fires them THEN unconditionally
   calls `this._chart.updatePane(UpdateLevel.Overlay, ...)` — a repaint is
   GUARANTEED on every selection change, so a module-level `Set<string>`
   (`SELECTED_OVERLAY_IDS`, `figure-kit.ts`) mutated in those callbacks and
   read inside `createPointFigures` is a fully reliable mechanism — the
   brief's own documented fallback ("always-show if selection-conditional
   proves unreliable") was never needed; selection-conditional works and
   ships as designed for the tools where it matters.

**A real, load-bearing discovery that reshaped the whole design**:
`needDefaultYAxisFigure`/`needDefaultXAxisFigure` (already `true` on every
one of the 12 targeted built-ins, unchanged) ALREADY render a native
price/date tag ON THE AXIS whenever the overlay is SELECTED — verified in
`OverlayYAxisView.prototype.getDefaultFigures`/`OverlayXAxisView.prototype
.getDefaultFigures` (`overlay.id === clickOverlayInfo.overlay?.id` gate).
This means the "shows when selected" half of TV parity for
horizontal/vertical pin tools was ALREADY THERE, natively, for free — the
only real, previously-unfilled gap was DURING DRAWING (before any
click-select event can exist, since `clickOverlayInfo` structurally cannot
reference an in-progress not-yet-placed overlay). Resulted in a genuinely
two-tier visibility design, not a uniform one:
- `segment`/`rayLine`/`straightLine`/`arrow`/`arrowMarker` (plain,
  undecorated line tools — TradingView's real "Trend Line"/"Ray"/"Extended
  Line") — full draw-OR-selected gating (`isStatsPillVisible`), TRUE TV
  parity: idle+unselected shows nothing extra.
- `horizontal*`/`vertical*` (price/date PIN tools) — pill shown ONLY
  while drawing (`isOverlayDrawing`, narrower); the selected case is
  correctly left to klinecharts' own native axis tag, avoiding the
  "don't double-label" collision the brief explicitly warned about.
- `priceChannelLine`/`parallelStraightLine`/`flatTopBottom`/
  `disjointChannel` (channel-width pills) — full draw-OR-selected, since
  no native equivalent exists for a computed width at all.
- `infoLine`/`trendAngle` (this workbench's own dedicated MEASURE tools,
  same category as `priceRange`/`dateRange`/`datePriceRange`) — kept their
  PRE-EXISTING always-on visibility, unchanged, a deliberate category
  distinction from the plain-line tools above, not an inconsistency.
- `priceLine` deliberately NOT re-registered at all — its own built-in
  `createPointFigures` already inline-renders the price value
  unconditionally (no gate whatsoever in the original), fully satisfying
  the ask with zero gap; re-registering would only add geometry-fidelity
  risk for no behavioral gain.

**Geometry-fidelity discovery, caught before shipping, not after**: the
true klinecharts default overlay line style is `Color.BLUE` (`#1677FF`) at
`size: 1` (`getDefaultOverlayStyle()`), NOT this codebase's usual
`INK_600`/`1.4` house convention — none of the 12 built-ins ever set an
explicit figure-level color/width, so EVERY already-drawn `segment`/
`rayLine`/etc. a user never recolored renders in `#1677FF`/1px today. Using
`INK_600`/1.4 as the override fallback would have silently RECOLORED every
pre-existing drawing of these tools the instant this shipped. Fixed with
new `KLINECHARTS_DEFAULT_LINE`/`KLINECHARTS_DEFAULT_LINE_WIDTH` constants
in `figure-kit.ts`, used ONLY by `built-in-stats.ts`'s fallback args — the
stats pill is new, the line's own look for anyone who never touched the
style editor is byte-identical to before.

**Geometry itself is a verbatim dist port, not a reimplementation from a
formula** — `figure-kit.ts` gained `linearYAtX`/`rayEndpoint`/
`straightLineEndpoints`/`parallelLinesGeometry`, each ported line-by-line
from the corresponding UNEXPORTED `dist/index.esm.js` internal
(`getLinearSlopeIntercept`/`getLinearYFromSlopeIntercept`/`getRayLine`/
`getParallelLines` — grepped `index.d.ts`, confirmed none are exported, so
reimplementation was the only option, not a choice). `horizontalSegment`/
`horizontalRayLine`/`verticalSegment`/`verticalRayLine` ALSO needed their
`performEventPressedMove`/`performEventMoveForDrawing` drag-pinning hooks
reproduced (these pin the second anchor's value/timestamp to the first) —
dropping them would have silently broken "drag stays level/plumb" for any
already-drawn instance of these 4 tools.

**Shared-helper extraction, per the brief's explicit ask**: `infoLine`
(`lines.ts`) refactored to call the new `buildDeltaStatsText` (`figure-kit
.ts`) instead of its own inline string-building — `segment`/`rayLine`/
`straightLine`/`arrow`/`arrowMarker` now call the exact SAME function, so
the Δ/%/bar-count STRING FORMAT is byte-identical across every 2-anchor
line tool in the workbench, confirmed a pure no-op refactor for `infoLine`
itself (its own output string is unchanged char-for-char — `EMERALD`/
`ROSE` constants equal the exact hex literals it used inline before).

**Gates, all green, 2026-08-05**: tsc clean across apps/web + apps/api +
all 4 packages (`validation`/`types`/`api-client`/`business-rules`); eslint
clean on every touched file; `verify-papertrading-engine.ts` 264/264
(untouched — `apps/api`, never imports `overlays/`); `npm run ta:check`
76/76 (untouched — `lib/ta/` stays klinecharts-import-free, confirmed by
grep); `next build` succeeds, First Load JS for all 3 paper-trading
terminal pages **identical to every prior sprint's baseline** (136/135/140
kB); `react-loadable-manifest.json` still exactly ONE dynamic-import entry
(3 chunk files, confirmed via `app-build-manifest.json` grep that none of
the 3 appear in any terminal page's sync list); async chunk total now ~426
KB uncompressed (up from the legends pass's ~416 KB, expected). Catalog/
enum/toolbar counts unchanged and re-verified programmatically (not
eyeballed): `ALL_DRAWING_OVERLAYS` 87 (no dupes), `TOOL_REGISTRY` 88 keys —
both EXACT, since this pass added zero new `DrawingOverlayName`s (all 12
target tools already existed; only their rendered figures changed).
`tool-registry.ts` itself has an EMPTY git diff (untouched, confirmed) —
no toolbar/persistence-adjacent file needed a single edit for this whole
pass, the strongest possible evidence the override path required no
wrapper-name/enum-widening fallback.

**Not done this session** (same posture as every prior TA Suite sprint):
live/interactive QA — draw each overridden built-in and confirm the pill
appears/disappears correctly across draw→place→deselect→reselect, verify
dragging a horizontal/vertical segment/ray keeps it level/plumb (the
reproduced hook behavior), verify the native axis price/date tag still
appears alongside (not instead of) the new during-drawing pill, verify
priceChannelLine's reflected 3rd line and its width pill visually — no dev
server/DB/authenticated session available this session. Static
verification (tsc/eslint/build/engine/ta:check/manifest inspection/direct
klinecharts source reading for every mechanism claim, hand-run format
sanity checks via `tsx -e`) was exhaustive; a live pass is still the
required next step before this ships.

**Files**: `apps/web/components/paper-trading/workbench/overlays/
figure-kit.ts` (+`KLINECHARTS_DEFAULT_LINE`/`_WIDTH`, `formatUnsignedPercentLabel`/
`formatDatePillLabel`, `isOverlayDrawing`/`isOverlaySelected`/
`isStatsPillVisible`/`trackOverlaySelection`, `buildDeltaStatsText`/
`buildChannelWidthText`, `linearYAtX`/`rayEndpoint`/`straightLineEndpoints`/
`parallelLinesGeometry`, `pixelYToPrice`/`priceToPixelY`); `overlays/
built-in-stats.ts` (new — the 11 built-in overrides); `overlays/index.ts`
(+1 import/call, registered LAST); `overlays/lines.ts` (`infoLine`
refactored onto the shared helper; `flatTopBottom`/`disjointChannel` gained
channel-width pills + `trackOverlaySelection`); `overlays/legacy-shapes.ts`
(`arrow` gained the stats pill + `trackOverlaySelection`); `overlays/
shapes.ts` (`arrowMarker` gained the stats pill + `trackOverlaySelection`).

**How to apply**: any FUTURE built-in override needs the same 2-step
verification this pass established — (1) grep `dist/index.d.ts` to confirm
the internal geometry helper you'd need isn't exported (if it IS exported,
import it instead of porting), (2) check `getDefaultOverlayStyle()` for the
TRUE default style before picking a fallback color/width, never assume this
codebase's usual `INK_600`/1.4 house convention applies to a built-in's own
un-styled default.
