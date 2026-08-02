import { z } from "zod";

/**
 * Charting Workbench (W1) — request body schemas for
 * apps/web/app/api/chart-drawings/*. Mirrors the shape of
 * packages/validation/src/paperTrading.ts.
 */

/**
 * `chartKey` prefix shapes, one per terminal family — see the ChartDrawing
 * model's doc comment in schema.prisma for the full rationale (why it's not
 * per-timeframe, why futures shares the INDEX: key):
 *   EQ:RELIANCE
 *   INDEX:NIFTY
 *   OPT:NIFTY:25-Sep-2026:24800:CE
 *
 * Deliberately loose on segment content (not re-validating symbol/expiry/
 * strike format here) — this regex only enforces the prefix shape and
 * overall length; the segments themselves are opaque identifiers the client
 * already trusts (same instrument keys the terminals already resolve).
 */
const CHART_KEY_PATTERN = /^(EQ|INDEX|OPT):[A-Za-z0-9:_\-. ]+$/;
export const CHART_KEY_MAX_LENGTH = 80;

export const chartKeySchema = z
  .string()
  .trim()
  .min(1, "chartKey is required.")
  .max(CHART_KEY_MAX_LENGTH, "chartKey is too long.")
  .regex(CHART_KEY_PATTERN, "chartKey must start with EQ:, INDEX:, or OPT: followed by an identifier.");

/**
 * The full overlay-name enum. 20 values shipped by the Charting Workbench
 * program (W1-W3): 16 KLineCharts built-ins + 4 custom overlays (`rect`,
 * `arrow`, `abcd`, `xabcd`). The TA Suite Sprint S1 (2026-08-02, see
 * `cto_assignment_brief_ta_suite_s1.md`) adds 42 more, family-grouped below,
 * bringing the total to 62. The 2026-08-03 founder-feedback pass adds 25
 * more (see `apps/web/components/paper-trading/workbench/tool-registry.ts`'s
 * module doc for the exact per-family breakdown and its "24 vs 25"
 * enumeration note), bringing the total to **87**. `highlighter` is NOT an
 * 88th value here — per plan decision D2 it's a toolbar-only alias that
 * persists as a `brush` row with preset styles, so it never appears in this
 * enum.
 */
export const CHART_DRAWING_OVERLAY_NAMES = [
  // Built-ins with a toolbar entry from W1/W2 onward.
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
  // Custom overlays from W3 — rect/arrow/abcd/xabcd.
  "rect",
  "arrow",
  "abcd",
  "xabcd",

  // ── S1: Pitchforks (4, 3pt) ──────────────────────────────────────────
  "andrewsPitchfork",
  "schiffPitchfork",
  "modifiedSchiffPitchfork",
  "insidePitchfork",

  // ── S1: Fibonacci (7) ────────────────────────────────────────────────
  "fibExtension",
  "fibFan",
  "fibTimezone",
  "fibArc",
  "fibCircle",
  "fibSpeedResistanceFan",
  "fibChannel",

  // ── S1: Gann (3, 2pt) ────────────────────────────────────────────────
  "gannBox",
  "gannFan",
  "gannSquare",

  // ── 2026-08-03: Fibonacci +5 ─────────────────────────────────────────
  "trendBasedFibTime",
  "fibSpiral",
  "fibSpeedResistanceArcs",
  "fibWedge",
  "pitchfan",

  // ── 2026-08-03: Gann +1 ──────────────────────────────────────────────
  "gannSquareFixed",

  // ── S1: Patterns / Elliott (9) ───────────────────────────────────────
  "cypher",
  "threeDrives",
  "headAndShoulders",
  "trianglePattern",
  "elliottImpulse",
  "elliottCorrection",
  "elliottTriangle",
  "elliottDoubleCombo",
  "elliottTripleCombo",

  // ── S1: Shapes (7; `highlighter` is a brush alias, not a value here) ──
  "ellipse",
  "rotatedRect",
  "triangleShape",
  "arcShape",
  "curve",
  "doubleCurve",
  "polyline",

  // ── S1: Measure / Position (5) ───────────────────────────────────────
  "longPosition",
  "shortPosition",
  "priceRange",
  "dateRange",
  "datePriceRange",

  // ── S1: Annotations (6) + emoji (1) ──────────────────────────────────
  "calloutText",
  "noteAnchored",
  "priceLabel",
  "flagMark",
  "arrowMarkUp",
  "arrowMarkDown",
  "emojiSticker",

  // ── 2026-08-03: Lines +6 (incl. the "Channels" group) ────────────────
  "infoLine",
  "trendAngle",
  "crossLine",
  "regressionTrend",
  "flatTopBottom",
  "disjointChannel",

  // ── 2026-08-03: Shapes +3 ────────────────────────────────────────────
  "arrowMarker",
  "circleShape",
  "pathLine",

  // ── 2026-08-03: Cycles +3 (new family) ───────────────────────────────
  "cyclicLines",
  "timeCycles",
  "sineLine",

  // ── 2026-08-03: Measure +2 ───────────────────────────────────────────
  "sector",
  "anchoredVWAP",

  // ── 2026-08-03: Annotations +5 ───────────────────────────────────────
  "textLabel",
  "priceNote",
  "pin",
  "commentBubble",
  "signpost",
] as const;

export type ChartDrawingOverlayName = (typeof CHART_DRAWING_OVERLAY_NAMES)[number];

export const overlayNameSchema = z.enum(CHART_DRAWING_OVERLAY_NAMES);

/**
 * One `{timestamp, value}` anchor point — timestamp/value-anchored (not
 * pixel-anchored), so a drawing survives an interval switch. 1-10 points
 * per drawing (a segment needs 2, an xabcd needs 6; 10 is a generous
 * ceiling above every overlay's real requirement).
 */
export const chartDrawingPointSchema = z.object({
  timestamp: z.number().int("timestamp must be an integer epoch-ms value.").positive("timestamp must be positive."),
  value: z.number().finite("value must be a finite number."),
});

export const chartDrawingPointsSchema = z
  .array(chartDrawingPointSchema)
  .min(1, "At least one point is required.")
  .max(10, "A drawing can have at most 10 points.");

/** Passthrough per-drawing style overrides (color, line width, ...) — opaque to the server, forwarded straight to KLineCharts' overlay style config. */
export const chartDrawingStylesSchema = z.record(z.string(), z.unknown());

export const createChartDrawingSchema = z.object({
  chartKey: chartKeySchema,
  overlayName: overlayNameSchema,
  points: chartDrawingPointsSchema,
  styles: chartDrawingStylesSchema.optional(),
});

export type CreateChartDrawingInput = z.infer<typeof createChartDrawingSchema>;

/**
 * PATCH body — `points`/`styles`/`visible` only. `chartKey` and
 * `overlayName` are immutable after creation (a drawing that needs a
 * different overlay type is deleted and re-created, never mutated in
 * place).
 */
export const updateChartDrawingSchema = z
  .object({
    points: chartDrawingPointsSchema.optional(),
    styles: chartDrawingStylesSchema.optional(),
    visible: z.boolean().optional(),
  })
  .refine((value) => value.points !== undefined || value.styles !== undefined || value.visible !== undefined, {
    message: "At least one of points, styles, or visible must be provided.",
  });

export type UpdateChartDrawingInput = z.infer<typeof updateChartDrawingSchema>;

/** Per-(userId, chartKey) row cap enforced by POST /api/chart-drawings — see that route's doc comment for the accepted-TOCTOU-window rationale. */
export const CHART_DRAWINGS_MAX_PER_CHART_KEY = 200;
