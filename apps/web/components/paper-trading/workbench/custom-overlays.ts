/**
 * Charting Workbench (W2 scaffold; W3 T1/T2 fills in the 4 custom shapes) —
 * the drawing toolbar's full overlay catalogue: the 16 KLineCharts BUILT-IN
 * overlay names (no `registerOverlay` needed — they ship inside `klinecharts`
 * itself, confirmed via the installed v10.0.1 package's own
 * `getSupportedOverlays()`/extension list) plus the 4 founder-named custom
 * shapes this file registers: `rect`, `arrow` (T1), `abcd`, `xabcd` (T2, the
 * harmonic-pattern tool the founder explicitly named).
 *
 * **Count correction carried from W1** (see project_workbench_w1 memory —
 * flag again here since the W3 brief's own T3 ticket text repeats the wrong
 * arithmetic): the real built-in count is **16**, not "17". Verified twice
 * now — once against W1's own explicit named list, again here directly
 * against the installed package's `extensions` array (`dist/index.esm.js`):
 * `[fibonacciLine, horizontalRayLine, horizontalSegment,
 * horizontalStraightLine, parallelStraightLine, priceChannelLine, priceLine,
 * rayLine, segment, straightLine, verticalRayLine, verticalSegment,
 * verticalStraightLine, simpleAnnotation, simpleTag, brush]` — 16 entries.
 * 16 built-in + 4 custom = **20 tools total**, not 21. The validation
 * enum's own name (`CHART_DRAWING_OVERLAY_NAMES`, `packages/validation/src/
 * chartDrawings.ts`) already has exactly 20 entries and needs no change.
 *
 * Registration pattern for the 4 customs mirrors `order-line-overlay.ts`'s
 * `registerWorkbenchOrderLineOverlay` exactly: module-level, idempotency-
 * guarded (`registered` boolean) so React 18 dev double-invoke / hot reload
 * never double-registers and throws.
 *
 * **Dragging** — every shape below sets `needDefaultPointFigure: true`
 * (unlike `pfOrderLine`, which deliberately opts OUT and builds its own wide
 * hit-figure because it renders a full-width line with no natural per-point
 * handle). These 4 shapes ARE point-anchored, so KLineCharts' own default
 * draggable circular handles at each anchor are exactly the "drag to
 * reposition" UI W3's brief asks for ("points draggable via klinecharts
 * default pressed-move") — no custom hit-testing figure needed. Verified
 * directly against the installed package's `OverlayImp.prototype
 * .eventPressedPointMove`/`eventPressedOtherMove` (`dist/index.esm.js`):
 * dragging a point handle updates just that point, dragging the shape's own
 * fill/line (any hit-testable figure that isn't a point handle) translates
 * every point together — BOTH paths mutate `overlay.points` before
 * `onPressedMoveEnd` fires, so `kline-chart.tsx`'s reprice/persist wiring
 * (which reads `event.overlay.points` in that same callback, shared code
 * path with the built-in overlays) works identically for a single-anchor
 * drag and a whole-shape drag, with zero special-casing for these 4 custom
 * names.
 *
 * **Progressive rendering** — `createPointFigures` is called incrementally
 * as the user places each point (confirmed against the installed package's
 * own built-in `segment`/`rayLine` templates, which do the same: `segment`
 * literally returns `[]` until `coordinates.length === 2`). Every shape
 * below renders a partial preview at 2..N-1 points rather than only the
 * final N-point shape, so the user sees the pattern take form as they
 * click — same UX as every built-in multi-point overlay.
 *
 * Color tokens match the Indigo-Futures palette (`apps/web/tailwind.config
 * .ts`'s `ink`/`signal` scales, confirmed by reading that file directly):
 * `rect`'s fill is `signal.sky` (`#0ea5e9`) at 8% opacity
 * (`rgba(14,165,233,0.08)`) with an `ink-400` (`#64748b`) 1px border;
 * `xabcd`'s two triangle fills are `signal.teal` (`#14b8a6`) at 10% opacity
 * (`rgba(20,184,166,0.10)`); `arrow`'s shaft+barb and `abcd`/`xabcd`'s solid
 * legs are `ink-600` (`#334155`); dashed diagonals use `ink-400`.
 */
import { registerOverlay, type Coordinate, type OverlayFigure, type OverlayCreateFiguresCallbackParams } from "klinecharts";

export const BUILT_IN_DRAWING_OVERLAYS = [
  "segment",
  "rayLine",
  "straightLine",
  "priceLine",
  "horizontalSegment",
  "verticalSegment",
  "horizontalRayLine",
  "verticalRayLine",
  "horizontalStraightLine",
  "verticalStraightLine",
  "priceChannelLine",
  "parallelStraightLine",
  "fibonacciLine",
  "brush",
  "simpleAnnotation",
  "simpleTag"
] as const;

export type BuiltInDrawingOverlay = (typeof BUILT_IN_DRAWING_OVERLAYS)[number];

/** The 4 founder-named custom shapes this file registers — see module doc. */
export const CUSTOM_DRAWING_OVERLAYS = ["rect", "arrow", "abcd", "xabcd"] as const;
export type CustomDrawingOverlay = (typeof CUSTOM_DRAWING_OVERLAYS)[number];

/** Full 20-name toolbar/validation catalogue — `workbench-toolbar.tsx` renders one button per entry; `kline-chart.tsx`'s drawings-hydration effect uses this as the "known overlay name" allowlist for the forward-compatible skip-unknown-rows behavior W1's schema design calls for. */
export const ALL_DRAWING_OVERLAYS = [...BUILT_IN_DRAWING_OVERLAYS, ...CUSTOM_DRAWING_OVERLAYS] as const;
export type DrawingOverlayName = (typeof ALL_DRAWING_OVERLAYS)[number];

const INK_400 = "#64748b";
const INK_600 = "#334155";
const SKY_FILL = "rgba(14,165,233,0.08)";
const TEAL_FILL = "rgba(20,184,166,0.10)";
const TEAL_BORDER = "rgba(20,184,166,0.4)";

function labelFigure(point: Coordinate, text: string): OverlayFigure {
  return {
    type: "text",
    attrs: { x: point.x, y: point.y - 14, text, align: "center", baseline: "bottom" },
    styles: {
      color: "#ffffff",
      backgroundColor: INK_600,
      size: 10,
      weight: 700,
      paddingLeft: 4,
      paddingRight: 4,
      paddingTop: 1,
      paddingBottom: 1,
      borderRadius: 3
    }
  };
}

function solidLine(coordinates: Coordinate[], color: string = INK_600): OverlayFigure {
  return { type: "line", attrs: { coordinates }, styles: { style: "solid", color, size: 1.4 } };
}

function dashedLine(coordinates: Coordinate[], color: string = INK_400): OverlayFigure {
  return { type: "line", attrs: { coordinates }, styles: { style: "dashed", color, size: 1.2, dashedValue: [4, 3] } };
}

function fillTriangle(coordinates: Coordinate[]): OverlayFigure {
  return {
    type: "polygon",
    attrs: { coordinates },
    styles: { style: "stroke_fill", color: TEAL_FILL, borderColor: TEAL_BORDER, borderSize: 1, borderStyle: "solid" }
  };
}

let registered = false;

/** Idempotent — safe to call from every KlineChart mount (dev double-invoke, hot reload, multiple workbench opens in one session), same guard shape as `registerWorkbenchOrderLineOverlay`. */
export function registerCustomDrawingOverlays(): void {
  if (registered) return;
  registered = true;

  // ── T1: rect — 2 anchors (opposite corners), totalStep 3. ───────────────
  registerOverlay({
    name: "rect",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [p0, p1] = coordinates;
      const x0 = Math.min(p0.x, p1.x);
      const x1 = Math.max(p0.x, p1.x);
      const y0 = Math.min(p0.y, p1.y);
      const y1 = Math.max(p0.y, p1.y);
      return [
        {
          type: "polygon",
          attrs: {
            coordinates: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 }
            ]
          },
          styles: { style: "stroke_fill", color: SKY_FILL, borderColor: INK_400, borderSize: 1, borderStyle: "solid" }
        }
      ];
    }
  });

  // ── T1: arrow — 2 anchors (start, end), totalStep 3. An atan2-computed ──
  // barb polygon at the endpoint; atan2(dy,dx) is quadrant-safe by
  // definition (no sign-error branch needed for up-right/up-left/down-
  // right/down-left — verified by construction, not by testing each case
  // separately), directly addressing the ticket's named highest-risk item.
  registerOverlay({
    name: "arrow",
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [p0, p1] = coordinates;
      const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const barbLength = 12;
      const barbAngle = Math.PI / 7;
      const backAngle = angle + Math.PI;
      const leftBarb: Coordinate = {
        x: p1.x + barbLength * Math.cos(backAngle - barbAngle),
        y: p1.y + barbLength * Math.sin(backAngle - barbAngle)
      };
      const rightBarb: Coordinate = {
        x: p1.x + barbLength * Math.cos(backAngle + barbAngle),
        y: p1.y + barbLength * Math.sin(backAngle + barbAngle)
      };
      return [
        solidLine([p0, p1]),
        {
          type: "polygon",
          attrs: { coordinates: [p1, leftBarb, rightBarb] },
          styles: { style: "stroke_fill", color: INK_600, borderColor: INK_600, borderSize: 1, borderStyle: "solid" }
        }
      ];
    }
  });

  // ── T2: abcd — 4 anchors (A,B,C,D), totalStep 5. Solid A-B/B-C, dashed ──
  // A-C/B-D diagonals — exactly the founder-locked spec (no C-D leg), not a
  // "corrected" harmonic-pattern shape.
  registerOverlay({
    name: "abcd",
    totalStep: 5,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [a, b, c, d] = coordinates;
      const figures: OverlayFigure[] = [solidLine([a, b]), labelFigure(a, "A"), labelFigure(b, "B")];
      if (coordinates.length >= 3) {
        figures.push(solidLine([b, c]), dashedLine([a, c]), labelFigure(c, "C"));
      }
      if (coordinates.length >= 4) {
        figures.push(dashedLine([b, d]), labelFigure(d, "D"));
      }
      return figures;
    }
  });

  // ── T2: xabcd — 5 anchors (X,A,B,C,D), totalStep 6. Solid legs X-A/A-B/ ──
  // B-C/C-D, translucent X-A-B and B-C-D triangle fills, dashed X-B/B-D
  // diagonals — the harmonic-pattern tool the founder named explicitly.
  registerOverlay({
    name: "xabcd",
    totalStep: 6,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates }: OverlayCreateFiguresCallbackParams<unknown>): OverlayFigure[] => {
      if (coordinates.length < 2) return [];
      const [x, a, b, c, d] = coordinates;
      const figures: OverlayFigure[] = [solidLine([x, a]), labelFigure(x, "X"), labelFigure(a, "A")];
      if (coordinates.length >= 3) {
        figures.push(solidLine([a, b]), labelFigure(b, "B"), fillTriangle([x, a, b]), dashedLine([x, b]));
      }
      if (coordinates.length >= 4) {
        figures.push(solidLine([b, c]), labelFigure(c, "C"));
      }
      if (coordinates.length >= 5) {
        figures.push(solidLine([c, d]), labelFigure(d, "D"), fillTriangle([b, c, d]), dashedLine([b, d]));
      }
      return figures;
    }
  });
}
