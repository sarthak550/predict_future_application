/**
 * Paper Trading Phase 4 — index-futures margin engine.
 *
 * A single flat, deliberately-conservative initial-margin rate applied
 * identically across all 5 registry indices (NIFTY, BANKNIFTY, FINNIFTY,
 * MIDCPNIFTY, NIFTYNXT50) — see the Phase 4 brief's "margin decision" section
 * for the full reasoning. Real SPAN+exposure margin recalculates daily off
 * live volatility/correlation matrices this codebase has no path to
 * computing; a flat rate biased ABOVE typical real minimums (roughly 10-13%
 * for NIFTY, somewhat higher for the more volatile sub-indices) is the
 * correct precision level for a simulator, matching the judgment P1 already
 * made for its flat blended exchange-charge rate.
 *
 * This is the ONE rate this file needs to get right — it is founder-locked,
 * not independently re-verified against a live SPAN calculator (deliberately
 * out of scope, see the brief's "explicitly OUT of scope" section).
 *
 * Non-negotiable disclaimer, rendered wherever margin or leverage is shown:
 * "Margin shown is an approximate, conservative simulator estimate — real
 * SPAN margin changes daily and may be lower. Never size a real trade off
 * this number."
 *
 * Pure module: zero I/O, zero Prisma — importable identically from apps/api
 * (the daily MTM/margin-call cron) and apps/web (order placement + the
 * client-side pre-trade margin estimate), exactly like costs.ts.
 */

/** Flat initial margin rate for INDEX_FUTURE positions — 15% of notional, every registry index, long or short. Founder-locked, deliberately above typical real SPAN+exposure minimums (~10-13% for NIFTY) so the simulator is conservative, not permissive. No stock-futures rate exists (stock futures are cut this phase — see the brief's verdict section); a tiered rate is explicitly deferred to Phase 4.1. */
export const INDEX_FUTURES_MARGIN_RATE = 0.15;

/**
 * Margin required to hold one INDEX_FUTURE position at its current notional
 * value (currentPrice * lotSize * lots, i.e. mark-to-market notional — NOT
 * the entry-price notional, so margin requirement tracks the live/settlement
 * price exactly like a real broker's daily margin recalculation). Identical
 * formula for long and short: futures margin is symmetric by construction
 * (both directions face a bounded, continuously-marked loss — see the
 * brief's "both LONG and SHORT" section), so this function takes no side
 * parameter.
 *
 * Pure, single input this phase (index-only, one flat rate) — deliberately
 * leaves room for a future tiered-rate parameter without being built now.
 */
export function computeFuturesMarginRequired(notional: number): number {
  return Math.abs(notional) * INDEX_FUTURES_MARGIN_RATE;
}
