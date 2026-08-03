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
 * own hand-written mini path parser (`drawPath`, ~line 5753 — confirmed to
 * support `M/L/H/V/C/S/Q/T/A/Z`, upper AND lower case, and MULTIPLE `M`
 * subpaths within one path string via repeated `ctx.moveTo` inside a single
 * `ctx.beginPath()`/`ctx.stroke()` pair — exactly what the gear glyph below
 * needs for its 6 disconnected spokes). Hand-authored 12×12 glyphs, `style:
 * "stroke"` throughout (a single fill-or-stroke choice applies to the WHOLE
 * path string, confirmed by reading `drawPath`'s single trailing
 * `ctx.fill()`/`ctx.stroke()` call — there is no per-subpath style).
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

const EYE_PATH = "M1,6 Q6,1.5 11,6 Q6,10.5 1,6 Z M6,4.3 A1.7,1.7 0 1,0 6,7.7 A1.7,1.7 0 1,0 6,4.3 Z";
const GEAR_PATH =
  "M6,3.8 A2.2,2.2 0 1,0 6,8.2 A2.2,2.2 0 1,0 6,3.8 Z" +
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
    size: 11,
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
