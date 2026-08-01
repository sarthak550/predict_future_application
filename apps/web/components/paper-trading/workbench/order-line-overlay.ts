/**
 * Charting Workbench (W2, T4) — the `pfOrderLine` custom KLineCharts overlay:
 * one horizontal, draggable-or-locked line per resting pending order / open
 * position, reproducing price-chart.tsx's SVG order-line contract (see that
 * file's own doc + chart-order-lines.ts) on a KLineCharts canvas instead of
 * inline SVG.
 *
 * Two `registerXxx` calls happen here, both MODULE-LEVEL and idempotency-
 * guarded (`registerOverlay`/`registerFigure` are global registries on the
 * `klinecharts` module scope — calling them twice, e.g. from React 18 dev
 * double-invoke or a hot reload, would otherwise throw/warn):
 *
 *   1. `pfHitLine` — a custom FIGURE (registerFigure), not overlay. Its own
 *      `draw` is a no-op (nothing painted) and its `checkEventOn` accepts
 *      any point within a wide vertical band around the line's y — this is
 *      the KLineCharts-canvas equivalent of price-chart.tsx's invisible
 *      `DRAG_HIT_STROKE_WIDTH`-tall `<line>`: klinecharts' BUILT-IN "line"
 *      figure type hit-tests against the stroke geometry itself (a few
 *      pixels), which would make the order line draggable only by grabbing
 *      a near-pixel-perfect y — this figure widens that to a real touch
 *      target, matching the SVG chart's 44px-tall hit region.
 *   2. `pfOrderLine` — the OVERLAY (registerOverlay). `totalStep: 1`, a
 *      single value-only point (renders as a full-width horizontal line via
 *      `createPointFigures`, which always draws x:0..bounding.width
 *      regardless of the point's own x/timestamp — so an unset/approximate
 *      timestamp on the point is harmless). Figures returned: the invisible
 *      `pfHitLine` hit target, the visible dashed/solid `line`, a
 *      right-aligned label `text` pill, and (when `cancellable`) a "×"
 *      `text` figure carrying `key: "cancel"` so the overlay's own `onClick`
 *      can distinguish a cancel tap from a plain click on the line.
 *
 * Every callback here is defined ONCE on the shared template and reads
 * everything it needs from `overlay.extendData` (typed `PfOrderLineExtendData`
 * below) — kline-chart.tsx is responsible for keeping `extendData` fresh via
 * `createOverlay`/`overrideOverlay` (see its own prop-sync effect), never by
 * re-registering this template per render.
 */
import { registerFigure, registerOverlay, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";

import { snapToTick, type ChartOrderLine } from "@/components/finance/chart-order-lines";

/** Vertical hit-test tolerance for `pfHitLine`, in canvas pixels either side of the line's y — mirrors chart-order-lines.ts's `DRAG_HIT_STROKE_WIDTH` (44px total) so the touch target is identically sized to the SVG chart's. */
const HIT_TOLERANCE_PX = 22;

/** How far inside the top/bottom edge an order line's label may render before it's treated as off-scale (mirrors price-chart.tsx's clampLineY guarantee — "never draw at the wrong spot silently" — reimplemented against KLineCharts' own already-pixel-converted coordinates rather than chart-order-lines.ts's SVG-geometry `clampLineY`, which takes a `yFor(value)` callback that doesn't fit this canvas pipeline). */
const EDGE_MARGIN_PX = 8;

function formatRupees(v: number): string {
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function lineColor(line: ChartOrderLine): string {
  if (line.kind === "pending-stop") return "#d97706";
  if (line.kind === "pending-limit") return "#0284c7";
  return line.side === "SELL" ? "#e11d48" : "#059669";
}

/**
 * Per-overlay-instance data, set at `createOverlay`/`overrideOverlay` time
 * by kline-chart.tsx. The three callbacks are STABLE (ref-backed) functions
 * built once by kline-chart.tsx — see that file's `buildExtendData` — so
 * re-creating this object every prop-sync render never churns the
 * registered template's own closures (there are none; the template reads
 * everything through `extendData`).
 */
export interface PfOrderLineExtendData {
  line: ChartOrderLine;
  /** Fires once, when a drag gesture begins — `currentPrice` is the overlay's own live point value at that instant (its pre-drag price), used to detect a no-op tap-without-movement at drag end. */
  onDragStart: (id: string, currentPrice: number) => void;
  /** Fires once, when a drag gesture (or a plain click/tap on the line) ends. `snappedPrice` is null when the line isn't draggable at all — the handler still needs to know the gesture ended so it can clear `draggingIdRef` / suppress the surface click-to-trade popover, even for a non-draggable (locked) line's tap. */
  onDragEnd: (id: string, snappedPrice: number | null) => void;
  onCancel: (id: string) => void;
  /** Fires on ANY interaction with this overlay (click, drag) — kline-chart.tsx uses this to arm its `dragJustEndedRef`, the same "swallow the synthetic click that follows an overlay interaction" guard price-chart.tsx implements via `e.stopPropagation()` on its own hit-line/cancel handlers. KLineCharts renders everything on one canvas (no separate DOM nodes to stopPropagation on), so this ref-flag is the equivalent mechanism. */
  onAnyInteraction: () => void;
}

let registered = false;

/** Idempotent — safe to call from every KlineChart mount (dev double-invoke, hot reload, multiple workbench opens in one session). */
export function registerWorkbenchOrderLineOverlay(): void {
  if (registered) return;
  registered = true;

  registerFigure<{ y: number; width: number }, unknown>({
    name: "pfHitLine",
    draw: () => {
      // Intentionally nothing painted — this figure exists purely to widen
      // the pfOrderLine overlay's hit-test band; the visible stroke is a
      // SEPARATE "line" figure below.
    },
    checkEventOn: (coordinate, attrs) => {
      if (!attrs) return false;
      return coordinate.x >= 0 && coordinate.x <= attrs.width && Math.abs(coordinate.y - attrs.y) <= HIT_TOLERANCE_PX;
    }
  });

  registerOverlay<PfOrderLineExtendData>({
    name: "pfOrderLine",
    totalStep: 1,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: (params: OverlayCreateFiguresCallbackParams<PfOrderLineExtendData>): OverlayFigure[] => {
      const ext = params.overlay.extendData;
      if (!ext) return [];
      const rawY = params.coordinates[0]?.y ?? 0;
      const width = params.bounding.width;
      const clampedY = Math.min(Math.max(rawY, EDGE_MARGIN_PX), Math.max(EDGE_MARGIN_PX, params.bounding.height - EDGE_MARGIN_PX));
      const offScale: "above" | "below" | null = rawY < EDGE_MARGIN_PX ? "above" : rawY > params.bounding.height - EDGE_MARGIN_PX ? "below" : null;
      const color = lineColor(ext.line);
      const dashed = ext.line.kind !== "position";

      // The point's LIVE value (tracks the pointer during an active drag,
      // equals the committed price at rest once the prop-sync effect has
      // called overrideOverlay) drives the label — same "relabel live
      // during drag" behavior as price-chart.tsx's own order-line text.
      const liveValue = params.overlay.points[0]?.value ?? ext.line.price;
      const labelPrefix = ext.line.label.split(" @ ")[0];
      const labelText = `${offScale ? (offScale === "above" ? "▲ " : "▼ ") : ""}${labelPrefix} @ ${formatRupees(snapToTick(liveValue))}`;

      const figures: OverlayFigure[] = [
        {
          key: "hit",
          type: "pfHitLine",
          attrs: { y: clampedY, width },
          ignoreEvent: false
        },
        {
          key: "line",
          type: "line",
          attrs: { coordinates: [{ x: 0, y: clampedY }, { x: width, y: clampedY }] },
          styles: {
            style: dashed ? "dashed" : "solid",
            color,
            size: 1.4,
            dashedValue: [4, 3]
          },
          ignoreEvent: true
        },
        {
          key: "label",
          type: "text",
          attrs: { x: width - 6, y: clampedY, text: labelText, align: "right", baseline: "middle" },
          styles: {
            color: "#ffffff",
            backgroundColor: color,
            size: 10,
            weight: 600,
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 4
          },
          ignoreEvent: true
        }
      ];

      if (ext.line.cancellable) {
        figures.push({
          key: "cancel",
          type: "text",
          attrs: { x: 14, y: clampedY, text: "×", align: "center", baseline: "middle" },
          styles: {
            color,
            backgroundColor: "#ffffff",
            size: 12,
            weight: 700,
            paddingLeft: 4,
            paddingRight: 4,
            paddingTop: 2,
            paddingBottom: 2,
            borderRadius: 8,
            borderColor: color,
            borderSize: 1,
            borderStyle: "solid"
          },
          ignoreEvent: false
        });
      }

      return figures;
    },
    onClick: (event) => {
      const ext = event.overlay.extendData;
      if (!ext) return;
      ext.onAnyInteraction();
      if (event.figure?.key === "cancel" && ext.line.cancellable) {
        ext.onCancel(ext.line.id);
      }
    },
    onPressedMoveStart: (event) => {
      const ext = event.overlay.extendData;
      if (!ext) return;
      ext.onDragStart(ext.line.id, event.overlay.points[0]?.value ?? ext.line.price);
    },
    onPressedMoveEnd: (event) => {
      const ext = event.overlay.extendData;
      if (!ext) return;
      ext.onAnyInteraction();
      const rawValue = event.overlay.points[0]?.value;
      if (!ext.line.draggable || rawValue == null || !Number.isFinite(rawValue)) {
        ext.onDragEnd(ext.line.id, null);
        return;
      }
      ext.onDragEnd(ext.line.id, snapToTick(rawValue));
    }
  });
}
