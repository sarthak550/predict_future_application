/**
 * TA Suite Sprint S1, T1 — `workbench/overlays/` replaces the old
 * `custom-overlays.ts` (256 lines, W3-era). The 20 pre-S1 tools' geometry
 * moved to `legacy-shapes.ts` (rect/arrow/abcd/xabcd — the 16 built-ins
 * need no registration, they ship inside `klinecharts` itself); the 42 new
 * S1 tools are split one family file per plan §1 grouping:
 * `pitchforks.ts`, `fibonacci.ts`, `gann.ts`, `patterns.ts` (patterns +
 * Elliott), `shapes.ts`, `measure.ts` (measure/position), `annotations.ts`
 * (+ emoji). Shared geometry helpers live in `figure-kit.ts`; shared
 * pitchfork anchor math in `pitchfork-math.ts`; the single source of truth
 * for the 62-name catalogue is `catalog.ts`; the compile-time
 * validation-package cross-check is `ta-consistency.ts` (imported below for
 * its types only — see that file's own doc for why).
 *
 * `registerTaOverlays()` is the ONE function `kline-chart.tsx` calls at
 * module scope (replacing the old `registerCustomDrawingOverlays()` call) —
 * it joins every family's register function behind a single idempotency
 * guard, the same `registered` boolean pattern `order-line-overlay.ts`'s
 * `registerWorkbenchOrderLineOverlay` established (safe under React 18 dev
 * double-invoke / hot reload).
 *
 * Founder-feedback pass (2026-08-03) adds `lines.ts` (the new "Lines"-family
 * Channels group + infoLine/trendAngle/crossLine) and `cycles.ts` (the new
 * Cycles family) — `fibonacci.ts`/`gann.ts`/`shapes.ts`/`measure.ts`/
 * `annotations.ts` are all EXTENDED in place (same register function names,
 * more overlays registered inside each), so this file's own wiring only
 * needs the 2 new imports/calls below.
 *
 * Founder-feedback pass (2026-08-05, "ratios in trend lines") adds
 * `built-in-stats.ts` — SAME-NAME overrides of 11 klinecharts BUILT-IN
 * overlays (`segment`/`rayLine`/`straightLine`/`horizontal*`/`vertical*`/
 * `priceChannelLine`/`parallelStraightLine`), registered LAST so its
 * `registerOverlay` calls run after klinecharts' own built-in registration
 * (which happens at module-init time, always earlier regardless — see that
 * file's own doc for the full override-vs-wrapper verification). No new
 * `DrawingOverlayName`s — these 11 names already existed in
 * `BUILT_IN_DRAWING_OVERLAYS` (`catalog.ts`), unchanged.
 */
import "./ta-consistency"; // type-only guard — see that file's doc.
import { registerLegacyShapeOverlays } from "./legacy-shapes";
import { registerPitchforkOverlays } from "./pitchforks";
import { registerFibonacciOverlays } from "./fibonacci";
import { registerGannOverlays } from "./gann";
import { registerPatternOverlays } from "./patterns";
import { registerShapeOverlays } from "./shapes";
import { registerMeasureOverlays } from "./measure";
import { registerAnnotationOverlays } from "./annotations";
import { registerLineOverlays } from "./lines";
import { registerCycleOverlays } from "./cycles";
import { registerBuiltInStatsOverlays } from "./built-in-stats";

export * from "./catalog";

let registered = false;

export function registerTaOverlays(): void {
  if (registered) return;
  registered = true;
  registerLegacyShapeOverlays();
  registerPitchforkOverlays();
  registerFibonacciOverlays();
  registerGannOverlays();
  registerPatternOverlays();
  registerShapeOverlays();
  registerMeasureOverlays();
  registerAnnotationOverlays();
  registerLineOverlays();
  registerCycleOverlays();
  registerBuiltInStatsOverlays();
}
