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
 * The full overlay-name enum from the founder-locked plan (§7): the ~17
 * KLineCharts built-in overlays drawable from W1 onward, plus the 4 custom
 * overlays (`rect`, `arrow`, `abcd`, `xabcd`) that don't get draw/render
 * logic until W3. Defining the full enum now means W3 needs zero schema or
 * validation changes when it wires those four up.
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
  // Custom overlays — enum values only until W3 registers their draw/render logic.
  "rect",
  "arrow",
  "abcd",
  "xabcd",
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
