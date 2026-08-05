/**
 * Chart Trading + Stop-Loss/Take-Profit (Sprint B, B1/B4) — pure, framework-
 * free helpers shared by `price-chart.tsx` (equity/index/futures spot) and
 * `terminal/premium-chart.tsx` (options premium). Factored out specifically
 * so the pixel<->price math is written ONCE: the Sprint B brief calls out
 * that "a sign or clamp error here silently produces click-to-prefill at the
 * wrong price" as a correctness bug users won't notice until it costs them
 * (simulated) money — forking this formula across two chart components would
 * double that risk for zero benefit.
 */

/** One overlay line drawn on a chart: a resting pending order or an open position's cost basis. */
export interface ChartOrderLine {
  id: string;
  price: number;
  kind: "pending-limit" | "pending-stop" | "position";
  side?: "BUY" | "SELL";
  label: string;
  /** Accepted for forward-compatibility with Sprint C's drag-to-reprice — no chart in this sprint wires actual pointer-drag behavior off this flag yet. */
  draggable?: boolean;
  cancellable?: boolean;
}

/** Rounds to the nearest 0.05 — the tick size every Paper Trading price/premium input already uses (see NewTradeForm's `step="0.05"`). Fixed to 2dp to avoid float-noise like 142.30000000000001. */
export function snapToTick(price: number, tick = 0.05): number {
  return Number((Math.round(price / tick) * tick).toFixed(2));
}

/**
 * Where an order line's price lands vertically. Off-scale prices (outside
 * the chart's own [min,max] — set by the underlying series' geometry, NEVER
 * widened to fit a line) clamp to the nearest edge and report which
 * direction they're off in, so the caller can render a ▲/▼ badge instead of
 * silently drawing the line at the wrong spot.
 */
export function clampLineY(
  price: number,
  min: number,
  max: number,
  yFor: (v: number) => number
): { y: number; offScale: "above" | "below" | null } {
  if (price > max) return { y: yFor(max), offScale: "above" };
  if (price < min) return { y: yFor(min), offScale: "below" };
  return { y: yFor(price), offScale: null };
}

/**
 * The pixel->price inverse. `clientYFraction` is (clientY - rect.top) /
 * rect.height — the pointer's position as a 0..1 fraction of the rendered
 * SVG's height, independent of how large the SVG is actually painted on
 * screen (the viewBox is a fixed `svgHeight`, CSS scales it). Clamped to
 * [min,max] — a click above/below the visible plot area still resolves to a
 * sane in-range price rather than an extrapolated nonsense value.
 */
export function priceAtFraction(
  clientYFraction: number,
  svgHeight: number,
  padTop: number,
  padBottom: number,
  min: number,
  max: number
): number {
  const ySvg = clientYFraction * svgHeight;
  const raw = min + (1 - (ySvg - padTop) / (svgHeight - padTop - padBottom)) * (max - min);
  return Math.min(max, Math.max(min, raw));
}

/** Stable empty array for referentially-stable "no order lines" defaults — an inline `[]` is a fresh identity every render (see price-chart.tsx's own EMPTY_SERIES precedent in options-page-client.tsx). */
export const EMPTY_ORDER_LINES: ChartOrderLine[] = [];

// ─── Founder bug fix (2026-08-04b) — position-line P&L coloring ───

/** Neutral (breakeven) tone — ink-500 from tailwind.config.ts, the same gray every other "no directional reading yet" state in this codebase uses. */
const POSITION_NEUTRAL_COLOR = "#475569";
const POSITION_PROFIT_COLOR = "#059669";
const POSITION_LOSS_COLOR = "#e11d48";
const PENDING_STOP_COLOR = "#d97706";
const PENDING_LIMIT_COLOR = "#0284c7";

/**
 * The color for ANY order line, one formula shared by every chart that
 * draws them (price-chart.tsx, terminal/premium-chart.tsx, the workbench's
 * `pfOrderLine` overlay) — factored out for the same reason the rest of
 * this module is: forking a formula this visible across charts risks it
 * silently drifting out of sync.
 *
 * Founder complaint, verbatim: "the line that we show the average price is
 * always green whereas it should only be green when we are in gross Profit
 * and red when lossing." Before this fix, a `kind: "position"` line was
 * colored by `line.side` alone (BUY -> always green, SELL -> always red) —
 * a static read of which SIDE the position is, not whether it's actually
 * winning. Pending LIMIT/STOP lines are unaffected (still their own fixed
 * amber/sky tones — those aren't P&L-bearing).
 *
 * `line.side` on a `"position"` line is this codebase's own established
 * convention for LONG vs SHORT (every caller — paper-trading-dashboard.tsx,
 * futures-page-client.tsx, options-page-client.tsx — sets it via
 * `quantity/lots < 0 ? "SELL" : "BUY"`, never the literal order side), so
 * `"SELL"` here means an open SHORT, not "the last order was a sell":
 *   - LONG ("BUY"): profit when `currentPrice > line.price` (price is the
 *     average cost / futures reference price).
 *   - SHORT ("SELL"): INVERTED — profit when `currentPrice < line.price`.
 *   - Exact equality, or `currentPrice` not resolved yet (no live tick has
 *     landed for this chart), falls back to the neutral tone rather than
 *     guessing a direction.
 */
export function orderLineColor(line: ChartOrderLine, currentPrice: number | null): string {
  if (line.kind === "pending-stop") return PENDING_STOP_COLOR;
  if (line.kind === "pending-limit") return PENDING_LIMIT_COLOR;
  if (currentPrice == null || currentPrice === line.price) return POSITION_NEUTRAL_COLOR;
  const isShort = line.side === "SELL";
  const inProfit = isShort ? currentPrice < line.price : currentPrice > line.price;
  return inProfit ? POSITION_PROFIT_COLOR : POSITION_LOSS_COLOR;
}

// ─── Chart Trading + SL/TP (Sprint C, C1) — drag-to-reprice hit-target sizing ───

/**
 * Screen-pixel (not SVG-viewBox-unit) stroke width for a draggable order
 * line's invisible hit target, paired with `vectorEffect="non-scaling-
 * stroke"` on the `<line>` that uses it — that attribute is what makes this
 * value a REAL screen pixel count regardless of how the viewBox is scaled to
 * fit the container (a fixed viewBox-unit stroke width would shrink/grow
 * with the container, which is exactly what a touch-target size must NOT
 * do). 44 matches the iOS/Android minimum recommended touch-target size
 * (Sprint C, C3's "≥44px effective on mobile" requirement) — generous here
 * since the line spans the chart's full width, so only vertical hit
 * tolerance matters.
 */
export const DRAG_HIT_STROKE_WIDTH = 44;

/** Same screen-pixel-constant technique as DRAG_HIT_STROKE_WIDTH, sized for a cancel button's circular hit target (paired with a near-zero `r` + `vectorEffect="non-scaling-stroke"` on an invisible circle drawn behind the visible one — see price-chart.tsx/premium-chart.tsx's order-line overlay). */
export const CANCEL_HIT_DIAMETER = 40;

export type OrderSide = "BUY" | "SELL";
export type OrderVariant = "LIMIT" | "STOP";

export interface OrderIntentOption {
  side: OrderSide;
  variant: OrderVariant;
  /** True for the sensible pre-selected default at this click position — see inferOrderIntentOptions's doc for the reasoning. */
  isDefault: boolean;
}

/**
 * Chart Trading + SL/TP (Sprint C, C2) — the click-popover's side/variant
 * inference rule (decision 3 of the Sprint C brief), factored out here so
 * price-chart.tsx and premium-chart.tsx apply the IDENTICAL rule rather than
 * two hand-synced copies — the same "don't fork the logic" discipline this
 * whole module exists for (see the module doc above).
 *
 * Only the two combinations that are actually PLACEABLE at the clicked price
 * are offered — a STOP's direction is validated at placement (see
 * `validateStopDirection` in apps/web/lib/paperTrading/pendingOrders.ts): a
 * SELL STOP requires its trigger strictly BELOW the current quote, a BUY
 * STOP requires its trigger strictly ABOVE it. Offering a combination that's
 * guaranteed to 422 on submit would contradict this whole feature's honesty
 * posture ("a drag interaction must never imply a fill guarantee it can't
 * back" — the identical reasoning extends to a click popover presenting a
 * guaranteed-invalid combination as if it were an ordinary choice).
 *
 *   - Clicked price AT OR BELOW the current price: a trader looking at a
 *     chart and clicking below the live price most plausibly means either
 *     "I want to buy in around here" (a BUY LIMIT — the sensible default,
 *     since a limit buy below the market is the classic "buy the dip" order)
 *     or "get me out if it falls to here" (a SELL STOP protecting an
 *     existing long — the ONLY STOP direction that validates below the
 *     current price).
 *   - Clicked price ABOVE the current price: "sell / take profit around
 *     here" (a SELL LIMIT — the sensible default, the classic "sell the
 *     rally" order) or "buy if it breaks out above here" (a BUY STOP — the
 *     ONLY STOP direction that validates above the current price).
 *
 * The boundary (`clickedPrice === currentPrice`) resolves to the "below"
 * branch, matching this codebase's existing `<=` convention for boundary
 * cases (see `isLimitCrossed`'s identical `<=` choice for a BUY fill).
 */
export function inferOrderIntentOptions(
  clickedPrice: number,
  currentPrice: number
): { primary: OrderIntentOption; secondary: OrderIntentOption | null } {
  const below = clickedPrice <= currentPrice;
  // A STOP whose trigger EQUALS the current quote is rejected at placement
  // (validateStopDirection uses strict inequality — a stop at the market is
  // always a user error), so at the exact boundary the popover offers no
  // stop option rather than one guaranteed to 422. QA-flagged edge, 2026-08-01.
  const stopPlaceable = clickedPrice !== currentPrice;
  return below
    ? {
        primary: { side: "BUY", variant: "LIMIT", isDefault: true },
        secondary: stopPlaceable ? { side: "SELL", variant: "STOP", isDefault: false } : null
      }
    : {
        primary: { side: "SELL", variant: "LIMIT", isDefault: true },
        secondary: { side: "BUY", variant: "STOP", isDefault: false }
      };
}
