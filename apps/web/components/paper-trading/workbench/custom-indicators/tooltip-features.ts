/**
 * Founder feedback (2026-08-04) — TradingView-grade on-chart indicator
 * legends, PART 1's interactive controls. `TooltipFeatureStyle[]` is
 * klinecharts' own REAL mechanism for clickable icons inside the per-pane
 * indicator tooltip row (verified against `dist/index.d.ts`'s
 * `IndicatorTooltipData.features`/`TooltipFeatureStyle` and, critically,
 * against `dist/index.esm.js`'s `IndicatorTooltipView.prototype
 * .drawStandardTooltipFeatures`, ~line 6980): each feature's `mouseDownEvent`
 * handler calls `pane.getChart().getChartStore().executeAction
 * ('onIndicatorTooltipFeatureClick', featureInfo)` where `featureInfo =
 * {paneId, feature, indicator}` — a REAL click path, not render-only. This
 * confirms features are interactive; the fallback DOM-overlay-legend design
 * the brief asked us to consider only if they weren't was never needed.
 *
 * **Icon glyphs**: klinecharts has no built-in icon font, and this codebase
 * has none either (it uses `lucide-react` SVG components everywhere else,
 * which can't be handed to a canvas-drawn tooltip feature). `TooltipFeatureStyle`
 * supports `type: "path"` — a SVG path string drawn via `dist/index.esm.js`'s
 * own hand-written mini path parser (`drawPath`, ~line 5753). MULTIPLE `M`
 * subpaths within one path string work fine (repeated `ctx.moveTo` inside a
 * single `ctx.beginPath()`/`ctx.stroke()` pair — used by the gear glyph's 6
 * disconnected spokes). `style: "stroke"` throughout (a single fill-or-stroke
 * choice applies to the WHOLE path string — `drawPath` has one trailing
 * `ctx.fill()`/`ctx.stroke()` call, no per-subpath style).
 *
 * **A REAL klinecharts@10.0.1 bug, found and worked around (founder bug
 * report, 2026-08-04 — a thick diagonal line smeared across the legend):**
 * `drawPath`'s per-command loop declares its pen-position bookkeeping
 * (`currentX`/`currentY`/`startX`/`startY`) WITH `var` INSIDE the
 * `commands.forEach` callback — a FRESH `0` every command, never carried
 * over from a preceding command's own assignment. Harmless for `M`/`L`/`C`/
 * `Q`/`Z` (each computes an absolute target from `args + offset` and calls
 * `ctx.moveTo`/`lineTo`/`bezierCurveTo`/`quadraticCurveTo` — the ACTUAL pen
 * position the canvas draws from is the browser's own internal path
 * pointer, never klinecharts' JS variable). Fatal for `A` (arc):
 * `drawEllipticalArc(ctx, x1, y1, args, offsetX, offsetY, isRelative)`
 * (confirmed reading its own body) uses `x1`/`y1` RAW/unoffset as the arc's
 * start point (`ellipticalArcToBeziers(x1, y1, ...)`) — only the END point
 * gets `+offsetX`/`+offsetY`. Since `currentX`/`currentY` are reset to `0`
 * on the SAME iteration an absolute `A` command runs (it never assigns them
 * itself before use), every `A` in our old EYE/GEAR paths started its arc
 * at canvas-absolute `(0,0)` — the chart's own top-left corner — and swept
 * to the correctly-offset endpoint near the real icon, a multi-hundred-
 * pixel bezier diagonal exactly matching the founder's screenshot. The `×`
 * icon (M/L only) was never exposed to this bug, matching the report's own
 * "the × appears to render fine" observation. Also broken for the identical
 * reason (not used here, noted for future glyph authors): `S`/`T` (smooth
 * curve variants, which pass `currentX`/`currentY` as explicit
 * `bezierCurveTo`/`quadraticCurveTo` arguments), `H`/`V` (need the OTHER
 * axis's carried-over value), and every lowercase RELATIVE command (`l`/`c`/
 * `q`/`a`/etc., which do `currentX += args[0]` against a value that's
 * always `0`). **Fix: only `M`/`L`/`Q`/`C`/`Z` (absolute, non-`A`) are safe
 * — the eye's pupil and the gear's ring below are now built from straight
 * line segments (a diamond, an octagon) instead of `A` arcs.** This is a
 * genuine upstream library bug, not a usage error on our side — confirmed
 * by reading `dist/index.esm.js` directly, not assumed; worked around
 * rather than patched (house law: never edit `node_modules`).
 *
 * **Global, not per-instance**: these are wired via `chart.setStyles
 * ({indicator:{tooltip:{features}}})` in `kline-chart.tsx` (the DEFAULT
 * `tooltipData.features` for every indicator whose OWN
 * `createTooltipDataSource` doesn't return its own — confirmed against
 * `IndicatorTooltipView.prototype.getIndicatorTooltipData`, ~line 7090: the
 * style-level `tooltipStyles.features` seeds `tooltipData.features` BEFORE
 * any custom `createTooltipDataSource` call, and a custom return only wins
 * if it explicitly supplies its own `features` array). This covers all 27
 * built-in indicator templates (which we cannot — and must not —
 * reimplement just to attach a per-instance tooltip callback) AND every
 * custom indicant except `ICHIMOKU` (`pack-a.ts`), which already defines its
 * own `createTooltipDataSource` and must explicitly re-export this SAME
 * array (see that file) so its icons don't get silently dropped by its
 * pre-existing `features: []` return.
 *
 * A real, documented limitation of the global-style approach: the icons'
 * appearance is STATIC (can't visually reflect e.g. "this specific instance
 * is currently hidden") since only a per-indicator `createTooltipDataSource`
 * — infeasible to attach to all 27 built-ins — has access to `indicator
 * .visible` at style-build time. The click still correctly toggles
 * visibility; klinecharts' own default legend behavior already signals
 * "hidden" for free (a hidden indicator's VALUE legends go empty while the
 * name/features row stays — verified in the same `getIndicatorTooltipData`
 * function, `if (indicator.visible) { ...legends... }`).
 */
import type { TooltipFeatureStyle } from "klinecharts";

// Almond outline (Q — safe) unchanged; pupil is now a small DIAMOND (M/L/Z —
// safe) instead of two `A` arcs. Center (6,6), half-diagonal 1.6: top
// (6,4.4), right (7.6,6), bottom (6,7.6), left (4.4,6).
const EYE_PATH = "M1,6 Q6,1.5 11,6 Q6,10.5 1,6 Z M6,4.4 L7.6,6 L6,7.6 L4.4,6 Z";
// Ring is now a regular OCTAGON (M/L/Z — safe) instead of two `A` arcs,
// center (6,6) radius 2.2 (8 vertices at 45° steps, hand-computed:
// cos45=sin45=0.7071 -> 2.2*0.7071=1.556). The 6 spokes (M/L only, already
// safe, unchanged) go from an inner radius ~2.3 to an outer radius ~3.7.
const GEAR_PATH =
  "M8.2,6 L7.56,7.56 L6,8.2 L4.44,7.56 L3.8,6 L4.44,4.44 L6,3.8 L7.56,4.44 Z" +
  " M8.3,6 L9.7,6 M7.15,7.99 L7.85,9.2 M4.85,7.99 L4.15,9.2 M3.7,6 L2.3,6 M4.85,4.01 L4.15,2.8 M7.15,4.01 L7.85,2.8";
const REMOVE_PATH = "M2.5,2.5 L9.5,9.5 M9.5,2.5 L2.5,9.5";

/** The 3 feature ids `kline-chart.tsx`'s `onIndicatorTooltipFeatureClick` subscriber dispatches on — a shared contract so the click handler and the feature definitions below can never drift apart. */
export const INDICATOR_FEATURE_EYE_ID = "pf-indicator-eye";
export const INDICATOR_FEATURE_GEAR_ID = "pf-indicator-gear";
export const INDICATOR_FEATURE_REMOVE_ID = "pf-indicator-remove";

function pathFeature(id: string, path: string): TooltipFeatureStyle {
  return {
    id,
    type: "path",
    content: { path, style: "stroke", lineWidth: 1.3 },
    position: "right",
    size: 12, // matches the glyphs' own 0-12 coordinate space exactly (was 11 — a minor pre-existing scale mismatch, tightened while already touching this file).
    color: "#94a3b8", // ink-400
    activeColor: "#0f172a", // ink-900, on hover
    backgroundColor: "transparent",
    activeBackgroundColor: "#f1f5f9", // ink-100, on hover
    borderRadius: 4,
    paddingLeft: 3,
    paddingTop: 3,
    paddingRight: 3,
    paddingBottom: 3,
    marginLeft: 6,
    marginTop: 4,
    marginRight: 0,
    marginBottom: 4
  };
}

/** Eye (visibility toggle) · Gear (settings) · × (remove) — in TradingView's own left-to-right order. Applied identically to every indicator instance; `kline-chart.tsx`'s click handler distinguishes WHICH instance via `featureInfo.indicator.id`, never by anything baked into these style objects. */
export const INDICATOR_TOOLTIP_FEATURES: TooltipFeatureStyle[] = [
  pathFeature(INDICATOR_FEATURE_EYE_ID, EYE_PATH),
  pathFeature(INDICATOR_FEATURE_GEAR_ID, GEAR_PATH),
  pathFeature(INDICATOR_FEATURE_REMOVE_ID, REMOVE_PATH)
];
