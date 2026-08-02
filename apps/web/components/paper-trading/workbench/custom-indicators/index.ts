/**
 * TA Suite Sprint S2 — joins `pack-a.ts` (T2, main-pane-heavy) and
 * `pack-b.ts` (T3, sub-pane) behind a single idempotency guard, the same
 * `registered` boolean pattern `overlays/index.ts`'s `registerTaOverlays()`
 * and `order-line-overlay.ts`'s `registerWorkbenchOrderLineOverlay()`
 * already established (safe under React 18 dev double-invoke / hot
 * reload). `kline-chart.tsx` calls this ONE function at module scope,
 * mirroring the S1 `registerTaOverlays()` call site exactly.
 */
import { registerPackA } from "./pack-a";
import { registerPackB } from "./pack-b";

let registered = false;

export function registerCustomIndicators(): void {
  if (registered) return;
  registered = true;
  registerPackA();
  registerPackB();
}
