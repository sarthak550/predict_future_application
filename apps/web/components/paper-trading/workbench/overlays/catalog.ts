/**
 * TA Suite Sprint S1, T1 — the single source of truth for the drawing-tool
 * catalogue, superseding `custom-overlays.ts` (deleted this sprint; see
 * `overlays/index.ts`'s module doc for the full refactor rationale).
 * `kline-chart.tsx` and the toolbar (`tool-registry.ts`/`workbench-toolbar
 * .tsx`) import `ALL_DRAWING_OVERLAYS`/`DrawingOverlayName` from HERE — same
 * export names as before, no breaking rename, per the ticket's explicit
 * constraint.
 *
 * 16 KLineCharts built-ins + 4 W3 customs (rect/arrow/abcd/xabcd) + 42 S1
 * tools + 25 tools from the 2026-08-03 founder-feedback pass (see
 * `tool-registry.ts`'s own module doc for the exact per-family breakdown
 * and the "24 vs 25" count-discrepancy note) = **87 total**. `highlighter`
 * is a toolbar-only alias for `brush` (plan decision D2) — it is NOT an
 * 88th entry here; see `tool-registry.ts` for where the alias is handled.
 */
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
  "simpleTag",
] as const;
export type BuiltInDrawingOverlay = (typeof BUILT_IN_DRAWING_OVERLAYS)[number];

/** W3 customs (rect/arrow/abcd/xabcd) — geometry now lives in `overlays/legacy-shapes.ts`. */
export const LEGACY_CUSTOM_DRAWING_OVERLAYS = ["rect", "arrow", "abcd", "xabcd"] as const;
export type LegacyCustomDrawingOverlay = (typeof LEGACY_CUSTOM_DRAWING_OVERLAYS)[number];

export const PITCHFORK_DRAWING_OVERLAYS = ["andrewsPitchfork", "schiffPitchfork", "modifiedSchiffPitchfork", "insidePitchfork"] as const;
export type PitchforkDrawingOverlay = (typeof PITCHFORK_DRAWING_OVERLAYS)[number];

export const FIBONACCI_DRAWING_OVERLAYS = [
  "fibExtension",
  "fibFan",
  "fibTimezone",
  "fibArc",
  "fibCircle",
  "fibSpeedResistanceFan",
  "fibChannel",
  // 2026-08-03 founder-feedback pass.
  "trendBasedFibTime",
  "fibSpiral",
  "fibSpeedResistanceArcs",
  "fibWedge",
  "pitchfan",
] as const;
export type FibonacciDrawingOverlay = (typeof FIBONACCI_DRAWING_OVERLAYS)[number];

export const GANN_DRAWING_OVERLAYS = ["gannBox", "gannFan", "gannSquare", "gannSquareFixed"] as const;
export type GannDrawingOverlay = (typeof GANN_DRAWING_OVERLAYS)[number];

export const PATTERN_DRAWING_OVERLAYS = [
  "cypher",
  "threeDrives",
  "headAndShoulders",
  "trianglePattern",
  "elliottImpulse",
  "elliottCorrection",
  "elliottTriangle",
  "elliottDoubleCombo",
  "elliottTripleCombo",
] as const;
export type PatternDrawingOverlay = (typeof PATTERN_DRAWING_OVERLAYS)[number];

export const SHAPE_DRAWING_OVERLAYS = [
  "ellipse",
  "rotatedRect",
  "triangleShape",
  "arcShape",
  "curve",
  "doubleCurve",
  "polyline",
  // 2026-08-03 founder-feedback pass.
  "arrowMarker",
  "circleShape",
  "pathLine",
] as const;
export type ShapeDrawingOverlay = (typeof SHAPE_DRAWING_OVERLAYS)[number];

/** 2026-08-03 founder-feedback pass — new family, 3 tools. */
export const CYCLE_DRAWING_OVERLAYS = ["cyclicLines", "timeCycles", "sineLine"] as const;
export type CycleDrawingOverlay = (typeof CYCLE_DRAWING_OVERLAYS)[number];

export const MEASURE_DRAWING_OVERLAYS = [
  "longPosition",
  "shortPosition",
  "priceRange",
  "dateRange",
  "datePriceRange",
  // 2026-08-03 founder-feedback pass.
  "sector",
  "anchoredVWAP",
] as const;
export type MeasureDrawingOverlay = (typeof MEASURE_DRAWING_OVERLAYS)[number];

export const ANNOTATION_DRAWING_OVERLAYS = [
  "calloutText",
  "noteAnchored",
  "priceLabel",
  "flagMark",
  "arrowMarkUp",
  "arrowMarkDown",
  "emojiSticker",
  // 2026-08-03 founder-feedback pass.
  "textLabel",
  "priceNote",
  "pin",
  "commentBubble",
  "signpost",
] as const;
export type AnnotationDrawingOverlay = (typeof ANNOTATION_DRAWING_OVERLAYS)[number];

/** 2026-08-03 founder-feedback pass — the "Lines"-family Channels group, folded into Lines rather than spun out as its own family (only 3 tools). */
export const LINE_DRAWING_OVERLAYS = ["infoLine", "trendAngle", "crossLine", "regressionTrend", "flatTopBottom", "disjointChannel"] as const;
export type LineDrawingOverlay = (typeof LINE_DRAWING_OVERLAYS)[number];

/** Full 87-name toolbar/validation catalogue. */
export const ALL_DRAWING_OVERLAYS = [
  ...BUILT_IN_DRAWING_OVERLAYS,
  ...LEGACY_CUSTOM_DRAWING_OVERLAYS,
  ...PITCHFORK_DRAWING_OVERLAYS,
  ...FIBONACCI_DRAWING_OVERLAYS,
  ...GANN_DRAWING_OVERLAYS,
  ...PATTERN_DRAWING_OVERLAYS,
  ...SHAPE_DRAWING_OVERLAYS,
  ...MEASURE_DRAWING_OVERLAYS,
  ...ANNOTATION_DRAWING_OVERLAYS,
  ...LINE_DRAWING_OVERLAYS,
  ...CYCLE_DRAWING_OVERLAYS,
] as const;
export type DrawingOverlayName = (typeof ALL_DRAWING_OVERLAYS)[number];

/** `"highlighter"` is a toolbar-only alias (D2) — this union is what `tool-registry.ts`'s `TOOL_REGISTRY` is keyed on, one entry wider than `DrawingOverlayName` itself. */
export type ToolbarToolName = DrawingOverlayName | "highlighter";
